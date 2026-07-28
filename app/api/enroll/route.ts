import { NextRequest, NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import getStripe from '@/lib/stripe';
import { fireTrigger } from '@/lib/messaging/triggers';

export const dynamic = 'force-dynamic';

/**
 * Enroll a borrower in consumer credit repair.
 *
 * Adapted from conduit-next's app/api/credit-repair/enroll/route.ts.
 * KEY DIFFERENCE: since CreditCoachIQ has no local `leads` table, the caller
 * (an agent using the UI, or an originating CRM like conduit-next calling
 * this as an integration) must pass the borrower's basic contact info
 * directly. We upsert a local `borrowers` row keyed on
 * (org_id, externalSource, externalLeadId) so repeat calls are idempotent.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    targetScore?: number;
    state?: string; // 2-letter, required for CROA state-registration enforcement
    externalSource?: string; // e.g. 'conduit-next'
    externalLeadId?: string; // the originating CRM's lead id, if any
    referralCode?: string; // referral_partners.referral_code, if this client was sent by a partner
  };

  if (!body.firstName || !body.lastName) {
    return NextResponse.json({ error: 'firstName and lastName are required' }, { status: 400 });
  }

  const sb = createAdminClient();

  // CROA state-registration gate: block enrollment in a state EquityNest
  // Capital isn't registered/bonded in yet, rather than silently onboarding
  // a client the business isn't legally allowed to serve there. A state with
  // no state_compliance_status row at all is treated as not-yet-cleared
  // (fail closed, not open) — add a row via the compliance admin UI to unlock it.
  if (body.state) {
    const state = body.state.toUpperCase();
    const { data: compliance } = await sb.from('state_compliance_status').select('active_clients_allowed').eq('org_id', orgId).eq('state', state).maybeSingle();
    if (!compliance?.active_clients_allowed) {
      return NextResponse.json({ error: `Not yet registered to serve clients in ${state}. Update state_compliance_status before enrolling this client.` }, { status: 403 });
    }
  }

  const externalSource = body.externalSource ?? 'manual';
  const externalLeadId = body.externalLeadId ?? null;

  // Resolve the referral partner before the insert so attribution lands in
  // the same upsert, not a separate write that could fail independently.
  let referralPartnerId: string | null = null;
  if (body.referralCode) {
    const { data: partner } = await sb
      .from('referral_partners')
      .select('id, commission_type, commission_value')
      .eq('org_id', orgId)
      .eq('referral_code', body.referralCode.trim())
      .eq('status', 'active')
      .maybeSingle();
    referralPartnerId = (partner?.id as string) ?? null;
  }

  // Upsert the local borrower record (idempotent on org + source + external id).
  const { data: borrower, error: borrowerError } = await sb
    .from('borrowers')
    .upsert(
      {
        org_id: orgId,
        external_source: externalSource,
        external_lead_id: externalLeadId,
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        state: body.state ? body.state.toUpperCase() : null,
        ...(referralPartnerId ? { referred_by_partner_id: referralPartnerId } : {}),
      },
      { onConflict: 'org_id,external_source,external_lead_id' }
    )
    .select('id, first_name, last_name, email')
    .single();

  if (borrowerError || !borrower) {
    return NextResponse.json({ error: borrowerError?.message ?? 'Could not create borrower' }, { status: 500 });
  }

  if (referralPartnerId) {
    await sb.from('referral_commission_events').insert({
      org_id: orgId,
      referral_partner_id: referralPartnerId,
      borrower_id: borrower.id,
      event_type: 'enrollment_attributed',
      notes: `Enrolled via referral code ${body.referralCode}`,
    });
  }

  // Idempotent enrollment.
  const { data: existing } = await sb
    .from('credit_repair_enrollments')
    .select('id')
    .eq('borrower_id', borrower.id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (existing) return NextResponse.json({ enrollmentId: existing.id, borrowerId: borrower.id, alreadyEnrolled: true });

  // Create a Stripe customer for the borrower (best-effort).
  let stripeCustomerId: string | null = null;
  try {
    const customer = await getStripe().customers.create({
      email: borrower.email ?? undefined,
      name: `${borrower.first_name ?? ''} ${borrower.last_name ?? ''}`.trim() || undefined,
      metadata: { borrower_id: borrower.id as string, org_id: orgId },
    });
    stripeCustomerId = customer.id;
  } catch (err) {
    console.error('[enroll] Stripe customer create failed:', err instanceof Error ? err.message : err);
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

  await sb.from('credit_repair_org_settings').upsert({ org_id: orgId }, { onConflict: 'org_id', ignoreDuplicates: true });

  void fireTrigger(orgId, 'client_enrolled', { borrowerId: borrower.id as string });

  return NextResponse.json({ enrollmentId: enrollment.id, borrowerId: borrower.id });
}

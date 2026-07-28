import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';
import { sendHandoffPackage, type HandoffPayload } from '@/lib/integrations/conduit-client';
import { transitionStage } from '@/lib/journey';

export const dynamic = 'force-dynamic';

/**
 * Stage 4: package a loan_ready client and push them into AshleyIQ
 * (conduit-next). Requires the client to already be in `loan_ready` — this
 * route does not itself verify the checklist; use /api/journey/transition to
 * get there first, which does enforce it.
 */
export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { borrower_id?: string };
  if (!body.borrower_id) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: borrower } = await sb.from('borrowers').select('*').eq('id', body.borrower_id).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });
  if (borrower.journey_stage !== 'loan_ready') {
    return NextResponse.json({ error: `Borrower must be in loan_ready stage (currently: ${borrower.journey_stage})` }, { status: 400 });
  }
  try {
    assertTierIncludes(borrower.plan_tier as string, 'ashleyiq_handoff');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const [{ data: enrollment }, { data: businessProfile }, { data: stackSummaryRows }, { data: checklist }, { data: profile }] = await Promise.all([
    sb.from('credit_repair_enrollments').select('starting_score_exp, current_score_exp, target_score').eq('borrower_id', body.borrower_id).eq('org_id', orgId).maybeSingle(),
    sb.from('business_credit_profiles').select('entity_name, entity_type, ein_last4').eq('borrower_id', body.borrower_id).eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('credit_stack_applications').select('approved_limit, status').eq('borrower_id', body.borrower_id).eq('org_id', orgId).eq('status', 'active'),
    sb.from('loan_ready_checklist_items').select('label, completed_at').eq('borrower_id', body.borrower_id).eq('org_id', orgId),
    sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle(),
  ]);

  const stackedCapital = (stackSummaryRows ?? []).reduce((sum, r) => sum + (Number(r.approved_limit) || 0), 0);

  const payload: HandoffPayload = {
    borrower: { firstName: borrower.first_name, lastName: borrower.last_name, email: borrower.email, phone: borrower.phone },
    creditTrajectory: {
      startingScore: enrollment?.starting_score_exp ?? null,
      currentScore: enrollment?.current_score_exp ?? null,
      targetScore: enrollment?.target_score ?? null,
    },
    stackedCapital: { totalAvailable: stackedCapital, activeApplicationCount: (stackSummaryRows ?? []).length },
    businessEntity: businessProfile
      ? { name: businessProfile.entity_name, entityType: businessProfile.entity_type, einLast4: businessProfile.ein_last4 ?? null }
      : null,
    checklist: (checklist ?? []).map((c) => ({ label: c.label, completedAt: c.completed_at })),
    planTier: borrower.plan_tier,
  };

  // Record the attempt before sending, so a failed push is never silently lost.
  const { data: pkg } = await sb.from('handoff_packages').insert({
    org_id: orgId, borrower_id: body.borrower_id, snapshot: payload, status: 'pending', created_by: profile?.id ?? null,
  }).select('id').single();

  const result = await sendHandoffPackage(payload);

  if (!pkg) return NextResponse.json({ error: 'Failed to record handoff attempt' }, { status: 500 });

  if (result.ok) {
    await sb.from('handoff_packages').update({
      status: 'sent', sent_to_conduit_at: new Date().toISOString(), conduit_lead_id: result.conduitLeadId ?? null,
    }).eq('id', pkg.id);
    await transitionStage({ orgId, borrowerId: body.borrower_id, toStage: 'handed_off', movedBy: profile?.id ?? null, reason: 'Handed off to AshleyIQ' });
    return NextResponse.json({ ok: true, conduitLeadId: result.conduitLeadId });
  }

  await sb.from('handoff_packages').update({ status: 'failed', error_message: result.error ?? 'Unknown error' }).eq('id', pkg.id);
  return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
}

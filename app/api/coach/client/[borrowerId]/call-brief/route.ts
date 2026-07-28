import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateCallPrepBrief } from '@/lib/ai/callPrepBrief';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { borrowerId: string } }) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_disputes')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb = createAdminClient();
  const { data: borrower } = await sb
    .from('borrowers')
    .select('first_name, plan_tier, journey_stage, journey_stage_updated_at')
    .eq('id', params.borrowerId).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id, current_score_exp, target_score')
    .eq('borrower_id', params.borrowerId).eq('org_id', orgId).maybeSingle();

  // Sentinel id when there's no enrollment yet — keeps these as real,
  // uniformly-typed Supabase queries (matching /api/coach/today's pattern)
  // instead of branching into differently-shaped Promise.resolve() stubs.
  const enrollmentId = (enrollment?.id as string | undefined) ?? '00000000-0000-0000-0000-000000000000';

  const [openDisputesRes, { data: recentDisputes }, { data: stackApps }] = await Promise.all([
    sb.from('credit_disputes').select('id', { count: 'exact', head: true }).eq('enrollment_id', enrollmentId).eq('org_id', orgId).is('response_logged_at', null),
    sb.from('credit_disputes').select('response_status, credit_tradelines(creditor_name)').eq('enrollment_id', enrollmentId).eq('org_id', orgId).not('response_logged_at', 'is', null).order('response_logged_at', { ascending: false }).limit(3),
    sb.from('credit_stack_applications').select('approved_limit').eq('borrower_id', params.borrowerId).eq('org_id', orgId).eq('status', 'active'),
  ]);

  const stackedCapital = (stackApps ?? []).reduce((s, a) => s + (Number(a.approved_limit) || 0), 0);
  const daysInStage = Math.floor((Date.now() - new Date(borrower.journey_stage_updated_at as string).getTime()) / (1000 * 60 * 60 * 24));

  const brief = await generateCallPrepBrief({
    firstName: (borrower.first_name as string) ?? 'the client',
    journeyStage: borrower.journey_stage as string,
    planTier: (borrower.plan_tier as string).replace('_', ' '),
    daysInStage,
    currentScore: enrollment?.current_score_exp ?? null,
    targetScore: enrollment?.target_score ?? null,
    openDisputeCount: openDisputesRes.count ?? 0,
    recentDisputeOutcomes: (recentDisputes ?? []).map((d) => {
      const tl = d.credit_tradelines as unknown as { creditor_name: string } | { creditor_name: string }[] | null;
      const creditorName = Array.isArray(tl) ? tl[0]?.creditor_name : tl?.creditor_name;
      return `${creditorName ?? 'account'}: ${(d.response_status as string).replace('_', ' ')}`;
    }),
    stackedCapital,
    activeApplicationCount: stackApps?.length ?? 0,
  });

  return NextResponse.json({ brief });
}

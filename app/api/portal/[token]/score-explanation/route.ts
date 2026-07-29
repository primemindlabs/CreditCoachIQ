import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';
import { explainScoreChange } from '@/lib/ai/scoreExplainer';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/score-explanation'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const previousScore = Number(searchParams.get('from'));
  const latestScore = Number(searchParams.get('to'));
  if (!Number.isFinite(previousScore) || !Number.isFinite(latestScore)) {
    return NextResponse.json({ error: 'from and to score query params are required' }, { status: 400 });
  }

  const sb = createAdminClient();
  const [{ data: borrower }, { data: enrollment }] = await Promise.all([
    sb.from('borrowers').select('first_name, plan_tier').eq('id', ctx.borrowerId).eq('org_id', ctx.orgId).maybeSingle(),
    sb.from('credit_repair_enrollments').select('id').eq('borrower_id', ctx.borrowerId).eq('org_id', ctx.orgId).maybeSingle(),
  ]);
  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    assertTierIncludes(borrower.plan_tier as string, 'ai_score_explainer');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  let resolvedDisputes: { creditorName: string; outcome: string }[] = [];
  if (enrollment?.id) {
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const { data: disputes } = await sb
      .from('credit_disputes')
      .select('response_status, response_logged_at, credit_tradelines(creditor_name)')
      .eq('enrollment_id', enrollment.id as string)
      .eq('org_id', ctx.orgId)
      .in('response_status', ['item_removed', 'item_updated'])
      .gte('response_logged_at', fortyFiveDaysAgo);
    resolvedDisputes = (disputes ?? []).map((d) => {
      const tl = d.credit_tradelines as unknown as { creditor_name: string } | { creditor_name: string }[] | null;
      const creditorName = Array.isArray(tl) ? tl[0]?.creditor_name : tl?.creditor_name;
      return { creditorName: creditorName ?? 'an account', outcome: d.response_status as string };
    });
  }

  const explanation = await explainScoreChange({
    firstName: (borrower.first_name as string) ?? 'there',
    previousScore,
    latestScore,
    resolvedDisputes,
  });

  return NextResponse.json({ explanation });
});

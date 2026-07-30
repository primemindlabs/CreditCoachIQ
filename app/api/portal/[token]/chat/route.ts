import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';
import { askPortalAssistant, type ChatTurn } from '@/lib/ai/portalAssistant';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/chat'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { question?: string; history?: ChatTurn[] };
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });
  if (question.length > 1000) return NextResponse.json({ error: 'Question is too long' }, { status: 400 });

  const sb = createAdminClient();
  const { data: borrower } = await sb.from('borrowers').select('first_name, plan_tier, journey_stage').eq('id', ctx.borrowerId).eq('org_id', ctx.orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    assertTierIncludes(borrower.plan_tier as string, 'ai_chat');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id, status, target_score, current_score_exp, current_score_eqx, current_score_tu, croa_disclosure_signed_at')
    .eq('borrower_id', ctx.borrowerId).eq('org_id', ctx.orgId).maybeSingle();

  const [{ data: tradelines }, { data: disputes }, { data: goals }] = await Promise.all([
    enrollment?.id
      ? sb.from('credit_tradelines').select('creditor_name, bureau, account_type, balance, status, payment_status, negative_remarks, is_disputable, dispute_status').eq('enrollment_id', enrollment.id as string).eq('org_id', ctx.orgId)
      : Promise.resolve({ data: [] }),
    enrollment?.id
      ? sb.from('credit_disputes').select('bureau, letter_type, cycle_number, response_status, sent_at, credit_tradelines(creditor_name)').eq('enrollment_id', enrollment.id as string).eq('org_id', ctx.orgId)
      : Promise.resolve({ data: [] }),
    sb.from('financial_goals').select('title, target_amount, current_amount, status').eq('borrower_id', ctx.borrowerId).eq('org_id', ctx.orgId),
  ]);

  const contextParts = [
    `Name: ${borrower.first_name}`,
    `Journey stage: ${borrower.journey_stage}`,
    enrollment
      ? `Enrollment status: ${enrollment.status}. Scores: Experian ${enrollment.current_score_exp ?? 'unknown'}, Equifax ${enrollment.current_score_eqx ?? 'unknown'}, TransUnion ${enrollment.current_score_tu ?? 'unknown'}. Target score: ${enrollment.target_score}. CROA agreement signed: ${enrollment.croa_disclosure_signed_at ? 'yes' : 'no'}.`
      : 'No active credit-repair enrollment on file.',
    tradelines?.length
      ? `Tradelines on file:\n${tradelines.map((t) => `- ${t.creditor_name} (${t.bureau}, ${t.account_type ?? 'unknown type'}): status=${t.status ?? 'unknown'}, payment_status=${t.payment_status ?? 'unknown'}, negative_remarks=${(t.negative_remarks as string[] | null)?.join(', ') || 'none'}, disputable=${t.is_disputable}, dispute_status=${t.dispute_status}`).join('\n')}`
      : 'No tradelines imported yet.',
    disputes?.length
      ? `Dispute letters:\n${disputes.map((d) => {
          const tl = d.credit_tradelines as unknown as { creditor_name: string } | { creditor_name: string }[] | null;
          const creditorName = Array.isArray(tl) ? tl[0]?.creditor_name : tl?.creditor_name;
          return `- ${creditorName ?? 'account'} (${d.bureau}), ${d.letter_type}, cycle ${d.cycle_number}: ${d.sent_at ? `sent, status=${d.response_status}` : 'drafted, not yet sent'}`;
        }).join('\n')}`
      : 'No dispute letters yet.',
    goals?.length
      ? `Financial goals:\n${goals.map((g) => `- ${g.title}: $${g.current_amount ?? 0} of ${g.target_amount ? `$${g.target_amount}` : 'no target set'} (${g.status})`).join('\n')}`
      : 'No financial goals set yet.',
  ];

  const answer = await askPortalAssistant({
    question,
    history: (body.history ?? []).filter((h) => h.role === 'user' || h.role === 'assistant'),
    context: contextParts.join('\n\n'),
  });

  return NextResponse.json({ answer });
});

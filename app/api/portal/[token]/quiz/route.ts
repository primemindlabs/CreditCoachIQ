import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { scoreQuizResponse, type QuizAnswerInput, type QuizQuestion } from '@/lib/quiz/score';
import { generateQuizSummary } from '@/lib/quiz/summarize';
import type { PlanTier } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/quiz'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });
  const sb = createAdminClient();

  const [{ data: questions }, { data: response }] = await Promise.all([
    sb.from('intake_quiz_questions').select('id, question_order, question_key, prompt, question_type, options, helper_text, is_required').eq('org_id', ctx.orgId).eq('is_active', true).order('question_order'),
    sb.from('intake_quiz_responses').select('id, status, completed_at, recommended_plan_tier').eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  let existingAnswers: { question_id: string; answer: unknown }[] = [];
  if (response?.id) {
    const { data } = await sb.from('intake_quiz_answers').select('question_id, answer').eq('response_id', response.id);
    existingAnswers = data ?? [];
  }

  // Mark as started on first view, so the coach can see engagement even before submission.
  if (response?.id && response.status === 'sent') {
    await sb.from('intake_quiz_responses').update({ status: 'started', started_at: new Date().toISOString() }).eq('id', response.id);
  }

  return NextResponse.json({ questions: questions ?? [], response: response ?? null, existingAnswers });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/quiz'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });
  const sb = createAdminClient();

  const body = (await req.json().catch(() => ({}))) as { answers?: QuizAnswerInput[]; smartCreditClicked?: boolean };
  if (!body.answers || !Array.isArray(body.answers)) return NextResponse.json({ error: 'answers array required' }, { status: 400 });

  const { data: response } = await sb
    .from('intake_quiz_responses')
    .select('id')
    .eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId)
    .in('status', ['sent', 'started'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!response) return NextResponse.json({ error: 'No active quiz invite found' }, { status: 404 });

  const { data: questions } = await sb.from('intake_quiz_questions').select('id, question_key, question_type, options').eq('org_id', ctx.orgId).eq('is_active', true);
  const questionList = (questions ?? []) as QuizQuestion[];

  // Persist raw answers (audit trail).
  await sb.from('intake_quiz_answers').upsert(
    body.answers.map((a) => ({ org_id: ctx.orgId, response_id: response.id, question_id: a.questionId, answer: a.value as unknown })),
    { onConflict: 'response_id,question_id' }
  );

  const scored = scoreQuizResponse(questionList, body.answers);

  const { data: borrower } = await sb.from('borrowers').select('first_name').eq('id', ctx.borrowerId).maybeSingle();
  const answersSummary = questionList
    .filter((q) => !['self_reported_score', 'primary_goal', 'goal_notes'].includes(q.question_key ?? ''))
    .map((q) => {
      const a = body.answers!.find((x) => x.questionId === q.id);
      return a ? `- ${q.question_key ?? q.id}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const aiSummary = await generateQuizSummary({
    firstName: (borrower?.first_name as string) ?? 'there',
    primaryGoal: scored.primaryGoal,
    selfReportedScore: scored.selfReportedScore,
    goalNotes: scored.goalNotes,
    recommendedTier: scored.recommendedTier,
    answersSummary: answersSummary || '(no additional answers)',
  });

  const patch: Record<string, unknown> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
    self_reported_score: scored.selfReportedScore,
    primary_goal: scored.primaryGoal,
    recommended_plan_tier: scored.recommendedTier,
    recommended_focus: scored.recommendedFocus,
    path_score: scored.pathScore,
    ai_summary: aiSummary,
  };
  if (body.smartCreditClicked) patch.smartcredit_link_clicked_at = new Date().toISOString();

  await sb.from('intake_quiz_responses').update(patch).eq('id', response.id);

  // Surface it to the assigned coach's task queue — reuses the existing coach ops infra.
  const { data: borrowerRow } = await sb.from('borrowers').select('assigned_agent_id').eq('id', ctx.borrowerId).maybeSingle();
  await sb.from('coach_tasks').insert({
    org_id: ctx.orgId,
    borrower_id: ctx.borrowerId,
    assigned_to: borrowerRow?.assigned_agent_id ?? null,
    source: 'system',
    type: 'quiz_completed',
    title: `Review intake quiz before consultation (recommended: ${scored.recommendedTier.replace('_', ' ')})`,
    due_date: new Date().toISOString().slice(0, 10),
  });

  return NextResponse.json({ ok: true, recommendedTier: scored.recommendedTier as PlanTier });
}

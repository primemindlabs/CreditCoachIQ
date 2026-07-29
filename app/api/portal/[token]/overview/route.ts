import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCallAllowance } from '@/lib/plans';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// The client-facing "home" view: where they are, what's next, and enough of
// a snapshot that logging in feels like real information, not a stub page.
export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/overview'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const sb = createAdminClient();
  const { orgId, borrowerId } = ctx;

  const [{ data: borrower }, { data: enrollment }, { data: stackApps }, { data: goals }, { data: quizResponse }, { data: upcomingCalls }, { data: unreadMessages }] = await Promise.all([
    sb.from('borrowers').select('first_name, last_name, plan_tier, journey_stage, journey_stage_updated_at, assigned_agent_id').eq('id', borrowerId).eq('org_id', orgId).maybeSingle(),
    // Real schema (migration 0002) is title/current_amount, not name/progress_amount —
    // the old select here silently errored on every load, so `goals` always came back
    // empty. Also pulling `id` so credit_report_uploads (score history) can be queried below.
    sb.from('credit_repair_enrollments').select('id, current_score_exp, target_score, status, croa_disclosure_signed_at').eq('borrower_id', borrowerId).eq('org_id', orgId).maybeSingle(),
    sb.from('credit_stack_applications').select('approved_limit').eq('borrower_id', borrowerId).eq('org_id', orgId).eq('status', 'active'),
    sb.from('financial_goals').select('id, title, target_amount, current_amount, target_date').eq('borrower_id', borrowerId).eq('org_id', orgId),
    sb.from('intake_quiz_responses').select('status, recommended_plan_tier, completed_at').eq('borrower_id', borrowerId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('call_bookings').select('id, scheduled_at, status').eq('borrower_id', borrowerId).eq('org_id', orgId).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(1),
    sb.from('portal_messages').select('id', { count: 'exact', head: true }).eq('borrower_id', borrowerId).eq('org_id', orgId).eq('sender', 'coach').is('read_at', null),
  ]);

  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Real score history — one point per successfully-parsed report upload,
  // oldest first. Never fabricated; the sparkline this feeds simply doesn't
  // render below 2 points.
  let scoreHistory: { date: string; score: number }[] = [];
  if (enrollment?.id) {
    const { data: uploads } = await sb
      .from('credit_report_uploads')
      .select('report_date, created_at, score_exp')
      .eq('enrollment_id', enrollment.id as string)
      .eq('org_id', orgId)
      .eq('parse_status', 'parsed')
      .not('score_exp', 'is', null)
      .order('created_at', { ascending: true });
    scoreHistory = (uploads ?? [])
      .filter((u) => u.score_exp != null)
      .map((u) => ({ date: (u.report_date as string) ?? (u.created_at as string), score: u.score_exp as number }));
  }

  let coachName: string | null = null;
  if (borrower.assigned_agent_id) {
    const { data: coach } = await sb.from('profiles').select('first_name, last_name').eq('id', borrower.assigned_agent_id).maybeSingle();
    if (coach) coachName = `${coach.first_name ?? ''} ${coach.last_name ?? ''}`.trim() || null;
  }

  const allowance = getCallAllowance(borrower.plan_tier as string);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: callsUsed } = await sb.from('call_bookings').select('id', { count: 'exact', head: true }).eq('borrower_id', borrowerId).eq('org_id', orgId).in('status', ['scheduled', 'completed']).gte('created_at', thirtyDaysAgo);

  const stackedCapital = (stackApps ?? []).reduce((s, a) => s + (Number(a.approved_limit) || 0), 0);

  return NextResponse.json({
    firstName: borrower.first_name,
    planTier: borrower.plan_tier,
    journeyStage: borrower.journey_stage,
    stageSince: borrower.journey_stage_updated_at,
    coachName,
    credit: enrollment ? { currentScore: enrollment.current_score_exp, targetScore: enrollment.target_score, status: enrollment.status } : null,
    croaSigned: !!enrollment?.croa_disclosure_signed_at,
    scoreHistory,
    stackedCapital,
    goals: goals ?? [],
    quiz: quizResponse ? { status: quizResponse.status, recommendedTier: quizResponse.recommended_plan_tier, completedAt: quizResponse.completed_at } : null,
    upcomingCall: upcomingCalls?.[0] ?? null,
    callAllowance: { used: callsUsed ?? 0, total: allowance, remaining: Math.max(0, allowance - (callsUsed ?? 0)) },
    unreadMessages: (unreadMessages as unknown as { count?: number })?.count ?? 0,
  });
});

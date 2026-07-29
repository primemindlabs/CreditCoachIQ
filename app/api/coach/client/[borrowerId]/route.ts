import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Consolidated client-detail payload for the coach dashboard's borrower
// page — one call instead of composing a dozen separate fetches for data
// that's always viewed together.
export async function GET(_req: Request, { params }: { params: { borrowerId: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const [{ data: borrower }, { data: enrollment }, { data: goals }, { data: tasks }, { data: recentCalls }] = await Promise.all([
    sb.from('borrowers').select('id, first_name, last_name, email, phone, plan_tier, journey_stage, journey_stage_updated_at, state, funding_status, assigned_agent_id, referred_by_partner_id, lead_status, interest_level').eq('id', params.borrowerId).eq('org_id', orgId).maybeSingle(),
    sb.from('credit_repair_enrollments').select('id, status, target_score, current_score_exp, current_score_eqx, current_score_tu, croa_disclosure_signed_at, mortgage_ready_at').eq('borrower_id', params.borrowerId).eq('org_id', orgId).maybeSingle(),
    sb.from('financial_goals').select('id, title, target_amount, current_amount, status').eq('borrower_id', params.borrowerId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(5),
    sb.from('coach_tasks').select('id, type, title, due_date, completed_at').eq('borrower_id', params.borrowerId).eq('org_id', orgId).is('completed_at', null).order('due_date', { ascending: true }).limit(10),
    sb.from('call_logs').select('id, status, duration_seconds, started_at, notes').eq('borrower_id', params.borrowerId).eq('org_id', orgId).order('started_at', { ascending: false }).limit(5),
  ]);

  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let referralPartnerName: string | null = null;
  if (borrower.referred_by_partner_id) {
    const { data: partner } = await sb.from('referral_partners').select('name').eq('id', borrower.referred_by_partner_id as string).maybeSingle();
    referralPartnerName = (partner?.name as string) ?? null;
  }

  // Real score history for the radial/sparkline on this page — one point
  // per successfully-parsed report upload, oldest first.
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

  return NextResponse.json({
    borrower,
    enrollment: enrollment ?? null,
    goals: goals ?? [],
    openTasks: tasks ?? [],
    recentCalls: recentCalls ?? [],
    referralPartnerName,
    scoreHistory,
  });
}

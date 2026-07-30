import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/permissions';
import { computeChurnRisk } from '@/lib/analytics/churnRisk';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Consolidated client-detail payload for the coach dashboard's borrower
// page — one call instead of composing a dozen separate fetches for data
// that's always viewed together.
export const GET = withErrorHandling(async function GET(_req: Request, { params }: { params: { borrowerId: string } }) {
  const { userId, orgId, role } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const [{ data: borrower }, { data: enrollment }, { data: goals }, { data: tasks }, { data: recentCalls }, { count: openComplaintCount }] = await Promise.all([
    sb.from('borrowers').select('id, first_name, last_name, email, phone, plan_tier, journey_stage, journey_stage_updated_at, state, funding_status, assigned_agent_id, referred_by_partner_id, lead_status, interest_level, coach_notes, address_line1, address_line2, city, postal_code').eq('id', params.borrowerId).eq('org_id', orgId).maybeSingle(),
    sb.from('credit_repair_enrollments').select('id, status, target_score, current_score_exp, current_score_eqx, current_score_tu, croa_disclosure_signed_at, mortgage_ready_at, payment_retry_count').eq('borrower_id', params.borrowerId).eq('org_id', orgId).maybeSingle(),
    sb.from('financial_goals').select('id, title, target_amount, current_amount, status').eq('borrower_id', params.borrowerId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(5),
    sb.from('coach_tasks').select('id, type, title, due_date, completed_at').eq('borrower_id', params.borrowerId).eq('org_id', orgId).is('completed_at', null).order('due_date', { ascending: true }).limit(10),
    sb.from('call_logs').select('id, status, duration_seconds, started_at, notes').eq('borrower_id', params.borrowerId).eq('org_id', orgId).order('started_at', { ascending: false }).limit(5),
    sb.from('complaint_log').select('id', { count: 'exact', head: true }).eq('borrower_id', params.borrowerId).eq('org_id', orgId).in('status', ['open', 'investigating']),
  ]);

  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Record-level enforcement, not just list-level: a coach who guesses/keeps
  // an old link to a borrower they're not assigned to shouldn't be able to
  // open the full detail page. Admins and unassigned records (nobody's
  // claimed it yet) are not blocked.
  if (role !== 'admin' && borrower.assigned_agent_id) {
    const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
    if (borrower.assigned_agent_id !== profile?.id) {
      return NextResponse.json({ error: 'This client is assigned to another coach.' }, { status: 403 });
    }
  }

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

  // Same computeChurnRisk used on the Clients list (lib/analytics/churnRisk.ts)
  // — kept as the auditable primary signal; the AI narrative endpoint
  // (/api/coach/client/[borrowerId]/churn-narrative) explains it further
  // using the actual activity timeline, it doesn't replace it.
  let churnRisk: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] } | null = null;
  if (enrollment && borrower.journey_stage_updated_at) {
    const daysInStage = Math.floor((Date.now() - new Date(borrower.journey_stage_updated_at as string).getTime()) / (1000 * 60 * 60 * 24));
    churnRisk = computeChurnRisk({
      daysInStage,
      paymentRetryCount: (enrollment.payment_retry_count as number) ?? 0,
      openComplaintCount: openComplaintCount ?? 0,
      journeyStage: borrower.journey_stage as string,
    });
  }

  return NextResponse.json({
    borrower,
    enrollment: enrollment ?? null,
    goals: goals ?? [],
    openTasks: tasks ?? [],
    recentCalls: recentCalls ?? [],
    referralPartnerName,
    scoreHistory,
    canReassign: hasPermission(role, 'manage_caseload'),
    churnRisk,
  });
});

const FUNDING_STATUSES = ['pre_qual', 'processing', 'underwriting', 'clear_to_close', 'funded', 'declined', 'withdrawn'];

// Save the freeform coach-notes scratchpad and/or the manual funding-status
// override. Separate from the status/interest-level PATCH on
// /api/leads/[id] — this exists for both leads and enrolled clients, not
// just the pre-conversion pipeline. funding_status is otherwise only ever
// written by the AshleyIQ cross-company sync (/api/integrations/funding-
// status-sync) — this is the manual fallback for orgs not running that
// integration, or for correcting it.
export const PATCH = withErrorHandling(async function PATCH(req: Request, { params }: { params: { borrowerId: string } }) {
  const { orgId, role } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    coachNotes?: string; fundingStatus?: string; assignedAgentId?: string | null;
    addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string;
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.coachNotes === 'string') patch.coach_notes = body.coachNotes;
  if (typeof body.fundingStatus === 'string') {
    if (!FUNDING_STATUSES.includes(body.fundingStatus)) return NextResponse.json({ error: 'Invalid funding status' }, { status: 400 });
    patch.funding_status = body.fundingStatus;
    patch.funding_status_updated_at = new Date().toISOString();
  }
  if (typeof body.addressLine1 === 'string') patch.address_line1 = body.addressLine1;
  if (typeof body.addressLine2 === 'string') patch.address_line2 = body.addressLine2;
  if (typeof body.city === 'string') patch.city = body.city;
  if (typeof body.postalCode === 'string') patch.postal_code = body.postalCode;

  const sb = createAdminClient();

  if ('assignedAgentId' in body) {
    if (!hasPermission(role, 'manage_caseload')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (body.assignedAgentId) {
      const { data: agent } = await sb.from('profiles').select('id').eq('id', body.assignedAgentId).eq('org_id', orgId).maybeSingle();
      if (!agent) return NextResponse.json({ error: 'That coach was not found in this org.' }, { status: 400 });
    }
    patch.assigned_agent_id = body.assignedAgentId ?? null;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const { error } = await sb.from('borrowers').update(patch).eq('id', params.borrowerId).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});

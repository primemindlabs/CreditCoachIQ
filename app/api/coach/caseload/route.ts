import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeChurnRisk } from '@/lib/analytics/churnRisk';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Every client assigned to the current coach (or, for admins, the whole
// org), with current stage, days-in-stage, and open-task count — the main
// coach dashboard view.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const scopeToSelf = role !== 'admin' && new URL(req.url).searchParams.get('all') !== 'true';

  let query = sb
    .from('borrowers')
    .select('id, first_name, last_name, plan_tier, journey_stage, journey_stage_updated_at, assigned_agent_id')
    .eq('org_id', orgId)
    .eq('lead_status', 'converted'); // leads live on /leads until converted — see migration 0013
  if (scopeToSelf && profile?.id) query = query.eq('assigned_agent_id', profile.id);

  const { data: borrowers, error } = await query.order('journey_stage_updated_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const borrowerIds = (borrowers ?? []).map((b) => b.id as string);
  const [{ data: enrollments }, { data: openComplaints }] = borrowerIds.length
    ? await Promise.all([
        sb.from('credit_repair_enrollments').select('borrower_id, payment_retry_count').eq('org_id', orgId).in('borrower_id', borrowerIds),
        sb.from('complaint_log').select('borrower_id').eq('org_id', orgId).in('borrower_id', borrowerIds).in('status', ['open', 'investigating']),
      ])
    : [{ data: [] }, { data: [] }];

  const retryByBorrower = new Map<string, number>();
  for (const e of enrollments ?? []) retryByBorrower.set(e.borrower_id as string, (e.payment_retry_count as number) ?? 0);
  const complaintCountByBorrower = new Map<string, number>();
  for (const c of openComplaints ?? []) {
    const key = c.borrower_id as string;
    complaintCountByBorrower.set(key, (complaintCountByBorrower.get(key) ?? 0) + 1);
  }

  const now = Date.now();
  const withDays = (borrowers ?? []).map((b) => {
    const daysInStage = Math.floor((now - new Date(b.journey_stage_updated_at as string).getTime()) / (1000 * 60 * 60 * 24));
    const risk = computeChurnRisk({
      daysInStage,
      paymentRetryCount: retryByBorrower.get(b.id as string) ?? 0,
      openComplaintCount: complaintCountByBorrower.get(b.id as string) ?? 0,
      journeyStage: b.journey_stage as string,
    });
    return { ...b, daysInStage, risk };
  });

  return NextResponse.json({ clients: withDays });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Agency-side summary: counts, recent notifications, enrolled borrowers.
// Adapted from conduit-next's app/api/credit-repair/overview/route.ts —
// joins `borrowers` (local) instead of conduit-next's `leads`.
export const GET = withErrorHandling(async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();

  const [{ data: enrollments }, { data: notifications }, { count: activeDisputes }] = await Promise.all([
    sb.from('credit_repair_enrollments')
      .select('id, status, subscription_status, target_score, current_score_exp, current_score_eqx, current_score_tu, mortgage_ready_at, created_at, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    sb.from('credit_repair_notifications')
      .select('id, type, payload, sent_at, read_at, enrollment_id, borrower_id, borrowers(first_name, last_name)')
      .eq('org_id', orgId)
      .order('sent_at', { ascending: false })
      .limit(25),
    sb.from('credit_disputes')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('response_status', 'awaiting_response'),
  ]);

  const list = enrollments ?? [];
  const now = new Date();
  const enrolledCount = list.filter((e) => !['closed', 'canceled'].includes(e.status as string)).length;
  const mortgageReadyMTD = list.filter((e) => {
    const m = e.mortgage_ready_at as string | null;
    if (!m) return false;
    const d = new Date(m);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const unread = (notifications ?? []).filter((n) => !n.read_at).length;

  return NextResponse.json({
    stats: { enrolledCount, activeDisputes: activeDisputes ?? 0, mortgageReadyMTD, unread },
    notifications: notifications ?? [],
    enrollments: list,
  });
});

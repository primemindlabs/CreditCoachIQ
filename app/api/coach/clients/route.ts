import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeChurnRisk } from '@/lib/analytics/churnRisk';
import { hasPermission } from '@/lib/auth/permissions';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

const SEGMENTS = ['leads', 'active', 'funded', 'denied'] as const;
type Segment = (typeof SEGMENTS)[number];

const SELECT =
  'id, first_name, last_name, email, phone, plan_tier, lead_status, interest_level, lead_source, last_contacted_at, ' +
  'journey_stage, journey_stage_updated_at, funding_status, funding_status_updated_at, assigned_agent_id, created_at';

// Single unified list behind Leads / Active clients / Funded / Denied tabs —
// replaces what used to be two separate pages+endpoints (/leads, /caseload)
// with one segmented view over the same `borrowers` table. The 4 segments
// read 3 independent columns (lead_status, journey_stage, funding_status)
// that were always separate concepts, just never unified in the UI:
//   leads   — lead_status != 'converted'
//   active  — converted, not exited, and not yet at a funding outcome
//   funded  — funding_status = 'funded'
//   denied  — funding_status IN ('declined', 'withdrawn')
// Note: a converted client whose journey_stage is 'exited' but who never
// reached a funding_status won't appear in any of the 4 tabs — that's a
// real edge case (dropped out before a funding decision), not handled by
// this pass; flagged rather than silently folded into "denied" since
// "exited the coaching program" and "loan denied" are different outcomes.
function scopeToSegment(query: any, segment: Segment) {
  if (segment === 'leads') return query.neq('lead_status', 'converted');
  if (segment === 'funded') return query.eq('funding_status', 'funded');
  if (segment === 'denied') return query.in('funding_status', ['declined', 'withdrawn']);
  return query.eq('lead_status', 'converted').neq('journey_stage', 'exited').or('funding_status.is.null,funding_status.in.(pre_qual,processing,underwriting,clear_to_close)');
}

export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const segment = (searchParams.get('segment') ?? 'leads') as Segment;
  if (!SEGMENTS.includes(segment)) return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const scopeToSelf = role !== 'admin' && searchParams.get('all') !== 'true';

  function scopedToAgent<T extends { eq: (...args: any[]) => any }>(q: T): T {
    return scopeToSelf && profile?.id ? q.eq('assigned_agent_id', profile.id) : q;
  }

  const rowsQuery = scopeToSegment(scopedToAgent(sb.from('borrowers').select(SELECT).eq('org_id', orgId)), segment)
    .order('created_at', { ascending: false })
    .limit(200);

  const countQueries = SEGMENTS.map((s) =>
    scopeToSegment(scopedToAgent(sb.from('borrowers').select('id', { count: 'exact', head: true }).eq('org_id', orgId)), s)
  );

  const [rowsRes, ...countRes] = await Promise.all([rowsQuery, ...countQueries]);

  if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 500 });

  const now = Date.now();
  const rows = (rowsRes.data ?? []).map((b: any) => {
    const daysInStage = b.journey_stage_updated_at ? Math.floor((now - new Date(b.journey_stage_updated_at).getTime()) / (1000 * 60 * 60 * 24)) : null;
    const risk = segment === 'active' && daysInStage != null
      ? computeChurnRisk({ daysInStage, paymentRetryCount: 0, openComplaintCount: 0, journeyStage: b.journey_stage })
      : null;
    return { ...b, daysInStage, risk };
  });

  const counts: Record<Segment, number> = { leads: 0, active: 0, funded: 0, denied: 0 };
  SEGMENTS.forEach((s, i) => { counts[s] = countRes[i]?.count ?? 0; });

  return NextResponse.json({
    people: rows,
    counts,
    segment,
    canManageIntake: hasPermission(role, 'manage_intake'),
    canManageCaseload: hasPermission(role, 'manage_caseload'),
    isAdmin: role === 'admin',
  });
});

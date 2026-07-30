import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeProductionGoals } from '@/lib/analytics';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Coach/org production goals — separate from financial_goals (per-client
// targets). Admin-managed, same access level as /api/analytics since goals
// and their progress are an analytics concern, not a caseload one.
export const GET = withErrorHandling(async function GET() {
  const { orgId, role } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const sb = createAdminClient();
  const goals = await computeProductionGoals(sb, orgId);
  return NextResponse.json({ goals });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    profileId?: string | null; metric?: string; period?: string; periodStart?: string; targetValue?: number;
  };
  if (!body.metric || !body.period || !body.periodStart || !body.targetValue) {
    return NextResponse.json({ error: 'metric, period, periodStart, and targetValue are required' }, { status: 400 });
  }
  if (!['clients_funded', 'new_enrollments'].includes(body.metric)) return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  if (!['monthly', 'quarterly', 'annual'].includes(body.period)) return NextResponse.json({ error: 'Invalid period' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const { data, error } = await sb
    .from('production_goals')
    .insert({
      org_id: orgId,
      profile_id: body.profileId || null,
      metric: body.metric,
      period: body.period,
      period_start: body.periodStart,
      target_value: body.targetValue,
      created_by: profile?.id ?? null,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
});

export const DELETE = withErrorHandling(async function DELETE(req: Request) {
  const { orgId, role } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb.from('production_goals').delete().eq('id', id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

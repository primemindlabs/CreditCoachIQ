import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Every client assigned to the current coach (or, for admins, the whole
// org), with current stage, days-in-stage, and open-task count — the main
// coach dashboard view.
export async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const scopeToSelf = role !== 'admin' && new URL(req.url).searchParams.get('all') !== 'true';

  let query = sb
    .from('borrowers')
    .select('id, first_name, last_name, plan_tier, journey_stage, journey_stage_updated_at, assigned_agent_id')
    .eq('org_id', orgId);
  if (scopeToSelf && profile?.id) query = query.eq('assigned_agent_id', profile.id);

  const { data: borrowers, error } = await query.order('journey_stage_updated_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const withDays = (borrowers ?? []).map((b) => ({
    ...b,
    daysInStage: Math.floor((now - new Date(b.journey_stage_updated_at as string).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  return NextResponse.json({ clients: withDays });
}

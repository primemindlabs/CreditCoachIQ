import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Coach review queue — completed quizzes awaiting sign-off before the call,
// or a full history if ?all=true.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const all = new URL(req.url).searchParams.get('all') === 'true';

  let query = sb.from('intake_quiz_responses').select('*, borrowers(first_name, last_name, assigned_agent_id)').eq('org_id', orgId);
  if (!all) query = query.eq('status', 'completed').is('coach_reviewed_at', null);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ responses: data ?? [] });
});

export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const { error } = await sb.from('intake_quiz_responses').update({ coach_reviewed_at: new Date().toISOString(), coach_reviewed_by: profile?.id ?? null }).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

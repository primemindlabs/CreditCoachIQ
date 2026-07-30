import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ connected: false });

  const { data } = await sb
    .from('coach_calendar_connections')
    .select('connected_email, calendar_id, created_at')
    .eq('org_id', orgId).eq('profile_id', profile.id).eq('provider', 'google')
    .maybeSingle();

  return NextResponse.json({ connected: !!data, connectedEmail: data?.connected_email ?? null, connectedAt: data?.created_at ?? null });
});

export const DELETE = withErrorHandling(async function DELETE() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  await sb.from('coach_calendar_connections').delete().eq('org_id', orgId).eq('profile_id', profile.id).eq('provider', 'google');
  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// A coach's own Calendly scheduling link — what the client portal's booking
// route serves up. v1 is deliberately simple: a public scheduling-page URL,
// not a full OAuth integration (no Calendly API token required to get this working).
export const GET = withErrorHandling(async function GET() {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { data, error } = await sb.from('coach_calendly_links').select('*').eq('org_id', orgId).eq('profile_id', profile.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data ?? null });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { scheduling_url?: string; calendly_event_type_uri?: string };
  if (!body.scheduling_url || !/^https:\/\/calendly\.com\//.test(body.scheduling_url)) {
    return NextResponse.json({ error: 'A valid https://calendly.com/... scheduling_url is required' }, { status: 400 });
  }
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { data, error } = await sb.from('coach_calendly_links').upsert({
    org_id: orgId, profile_id: profile.id, scheduling_url: body.scheduling_url, calendly_event_type_uri: body.calendly_event_type_uri ?? null, is_active: true,
  }, { onConflict: 'org_id,profile_id' }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Per-coach saved filter presets on the unified Clients pipeline — one row
// per (profile, name). Scoped to the requesting coach only; there's no
// org-wide sharing of views yet (each coach builds their own).
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ views: [] });

  const segment = new URL(req.url).searchParams.get('segment');
  let query = sb.from('saved_views').select('id, name, segment, filters, created_at').eq('org_id', orgId).eq('profile_id', profile.id);
  if (segment) query = query.eq('segment', segment);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ views: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; segment?: string; filters?: Record<string, unknown> };
  if (!body.name?.trim() || !body.segment) return NextResponse.json({ error: 'name and segment are required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { data, error } = await sb
    .from('saved_views')
    .upsert(
      { org_id: orgId, profile_id: profile.id, name: body.name.trim(), segment: body.segment, filters: body.filters ?? {} },
      { onConflict: 'profile_id,name' }
    )
    .select('id, name, segment, filters, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ view: data });
});

export const DELETE = withErrorHandling(async function DELETE(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { error } = await sb.from('saved_views').delete().eq('id', id).eq('org_id', orgId).eq('profile_id', profile.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});

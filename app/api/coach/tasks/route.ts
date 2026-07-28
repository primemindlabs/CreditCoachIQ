import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const url = new URL(req.url);
  const all = url.searchParams.get('all') === 'true';
  let query = sb.from('coach_tasks').select('*, borrowers(first_name, last_name)').eq('org_id', orgId).is('completed_at', null);
  if (!all && profile?.id) query = query.eq('assigned_to', profile.id);

  const { data, error } = await query.order('due_date', { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as {
    borrower_id?: string; assigned_to?: string; title?: string; due_date?: string; type?: string;
  };
  if (!body.title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const { data, error } = await sb.from('coach_tasks').insert({
    org_id: orgId, borrower_id: body.borrower_id ?? null, assigned_to: body.assigned_to ?? null,
    title: body.title, due_date: body.due_date ?? null, type: body.type ?? null, source: 'manual',
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; completed?: boolean };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const patch = { completed_at: b.completed ? new Date().toISOString() : null };
  const { error } = await sb.from('coach_tasks').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

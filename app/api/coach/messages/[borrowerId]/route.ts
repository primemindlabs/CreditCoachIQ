import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Coach side of the two-way portal thread — mirrors app/api/portal/[token]/messages.
export async function GET(_req: Request, { params }: { params: { borrowerId: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('portal_messages').select('*').eq('org_id', orgId).eq('borrower_id', params.borrowerId).order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('portal_messages').update({ read_at: new Date().toISOString() }).eq('org_id', orgId).eq('borrower_id', params.borrowerId).eq('sender', 'borrower').is('read_at', null);

  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: Request, { params }: { params: { borrowerId: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { body?: string };
  if (!body.body?.trim()) return NextResponse.json({ error: 'Message body required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const { data, error } = await sb.from('portal_messages').insert({
    org_id: orgId, borrower_id: params.borrowerId, sender: 'coach', sender_profile_id: profile?.id ?? null, body: body.body.trim(),
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}

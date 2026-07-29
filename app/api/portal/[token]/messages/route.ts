import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/messages'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });
  const sb = createAdminClient();

  const { data: messages, error } = await sb
    .from('portal_messages')
    .select('id, sender, body, created_at, read_at')
    .eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Client viewing the thread marks the coach's messages as read.
  await sb.from('portal_messages').update({ read_at: new Date().toISOString() }).eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).eq('sender', 'coach').is('read_at', null);

  return NextResponse.json({ messages: messages ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/messages'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { body?: string };
  if (!body.body?.trim()) return NextResponse.json({ error: 'Message body required' }, { status: 400 });

  const sb = createAdminClient();
  const { data, error } = await sb.from('portal_messages').insert({
    org_id: ctx.orgId, borrower_id: ctx.borrowerId, sender: 'borrower', body: body.body.trim(),
  }).select('id, created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Let the coach know without requiring them to poll the portal — reuses the existing task queue.
  const { data: borrower } = await sb.from('borrowers').select('assigned_agent_id, first_name').eq('id', ctx.borrowerId).maybeSingle();
  await sb.from('coach_tasks').insert({
    org_id: ctx.orgId, borrower_id: ctx.borrowerId, assigned_to: borrower?.assigned_agent_id ?? null,
    source: 'system', type: 'portal_message', title: `New portal message from ${borrower?.first_name ?? 'client'}`, due_date: new Date().toISOString().slice(0, 10),
  });

  return NextResponse.json({ message: data });
});

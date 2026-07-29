import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// List + review dispute letters (drafts awaiting approval, and sent/response history).
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const enrollmentId = url.searchParams.get('enrollment_id');
  const pendingApprovalOnly = url.searchParams.get('pending_approval') === 'true';

  const sb = createAdminClient();
  let query = sb.from('credit_disputes').select('*, credit_tradelines(creditor_name)').eq('org_id', orgId);
  if (enrollmentId) query = query.eq('enrollment_id', enrollmentId);
  if (pendingApprovalOnly) query = query.is('sent_at', null);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disputes: data ?? [] });
});

// Edit a drafted letter's body before approval — coaches can hand-tune AI output.
export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; letter_body?: string };
  if (!b.id || !b.letter_body) return NextResponse.json({ error: 'id and letter_body required' }, { status: 400 });
  const sb = createAdminClient();
  const { error } = await sb.from('credit_disputes').update({ letter_body: b.letter_body }).eq('id', b.id).eq('org_id', orgId).is('sent_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

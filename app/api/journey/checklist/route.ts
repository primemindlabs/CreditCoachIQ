import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Coach-configurable loan-ready checklist for a client — the gate checked
// by lib/journey.ts before a client can advance to `loan_ready`.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('loan_ready_checklist_items').select('*').eq('org_id', orgId).eq('borrower_id', borrowerId).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as { borrower_id?: string; label?: string; is_required?: boolean };
  if (!body.borrower_id || !body.label) return NextResponse.json({ error: 'borrower_id and label are required' }, { status: 400 });
  const { data, error } = await sb.from('loan_ready_checklist_items').insert({
    org_id: orgId, borrower_id: body.borrower_id, label: body.label, is_required: body.is_required ?? true,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
});

// PATCH — check off an item. Always requires the verifying coach's profile id.
export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; completed?: boolean };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  const patch = b.completed
    ? { completed_at: new Date().toISOString(), verified_by: profile?.id ?? null }
    : { completed_at: null, verified_by: null };
  const { error } = await sb.from('loan_ready_checklist_items').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// A formal complaint/dispute-resolution log — CROA-adjacent best practice,
// separate from credit_disputes (which is the letter-drafting pipeline).
// This is the durable record when something escalates beyond normal
// handling: a client complaint, a bureau non-response, a billing dispute.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_complaints')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const borrowerId = searchParams.get('borrowerId');
  const status = searchParams.get('status');

  const sb = createAdminClient();
  let query = sb
    .from('complaint_log')
    .select('id, borrower_id, enrollment_id, dispute_id, filed_by, category, description, status, resolution_notes, opened_at, resolved_at, borrowers(first_name, last_name)')
    .eq('org_id', orgId)
    .order('opened_at', { ascending: false });
  if (borrowerId) query = query.eq('borrower_id', borrowerId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ complaints: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_complaints')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    borrowerId?: string; enrollmentId?: string; disputeId?: string;
    filedBy?: string; category?: string; description?: string;
  };
  if (!body.borrowerId || !body.filedBy || !body.category || !body.description) {
    return NextResponse.json({ error: 'borrowerId, filedBy, category, and description are required' }, { status: 400 });
  }

  const sb = createAdminClient();
  const [{ data: profile }, { data: borrower }] = await Promise.all([
    sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle(),
    sb.from('borrowers').select('assigned_agent_id').eq('id', body.borrowerId).eq('org_id', orgId).maybeSingle(),
  ]);
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });

  const { data: complaint, error } = await sb
    .from('complaint_log')
    .insert({
      org_id: orgId,
      borrower_id: body.borrowerId,
      enrollment_id: body.enrollmentId ?? null,
      dispute_id: body.disputeId ?? null,
      filed_by: body.filedBy,
      category: body.category,
      description: body.description,
      opened_by: profile?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !complaint) return NextResponse.json({ error: error?.message ?? 'Could not log complaint' }, { status: 500 });

  // Surface it on the assigned coach's task queue — same lightweight
  // notification pattern used for readiness nudges (source: 'system').
  await sb.from('coach_tasks').insert({
    org_id: orgId,
    borrower_id: body.borrowerId,
    assigned_to: (borrower.assigned_agent_id as string) ?? null,
    source: 'system',
    type: 'complaint_opened',
    title: `New ${body.category.replace('_', ' ')} complaint needs review`,
  });

  return NextResponse.json({ ok: true, id: complaint.id });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
const INTEREST_LEVELS = ['hot', 'warm', 'cold'];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_intake')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { status?: string; interestLevel?: string; note?: string };
  if (body.status && !STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  if (body.interestLevel && !INTEREST_LEVELS.includes(body.interestLevel)) return NextResponse.json({ error: 'Invalid interest level' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const patch: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
  if (body.status) patch.lead_status = body.status;
  if (body.interestLevel) patch.interest_level = body.interestLevel;

  const { error } = await sb.from('borrowers').update(patch).eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.status) {
    await sb.from('lead_activity_log').insert({
      org_id: orgId, borrower_id: params.id, actor_id: profile?.id ?? null,
      type: 'status_change', body: `Status changed to ${body.status}`,
    });
  }
  if (body.note?.trim()) {
    await sb.from('lead_activity_log').insert({
      org_id: orgId, borrower_id: params.id, actor_id: profile?.id ?? null,
      type: 'note', body: body.note.trim(),
    });
  }

  return NextResponse.json({ ok: true });
}

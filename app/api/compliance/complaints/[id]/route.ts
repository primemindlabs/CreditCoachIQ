import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'investigating', 'resolved', 'escalated_cfpb'];

export const PATCH = withErrorHandling(async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_complaints')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { status?: string; resolutionNotes?: string };
  if (body.status && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) {
    update.status = body.status;
    if (body.status === 'resolved') update.resolved_at = new Date().toISOString();
  }
  if (body.resolutionNotes !== undefined) update.resolution_notes = body.resolutionNotes;

  const sb = createAdminClient();
  const { error } = await sb.from('complaint_log').update(update).eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

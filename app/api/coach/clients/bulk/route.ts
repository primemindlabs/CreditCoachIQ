import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/permissions';
import { sendSms, TWILIO_FROM } from '@/lib/sms';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BULK = 100;

// Bulk actions for the unified Clients list — row-select, then reassign or
// text a batch at once. Kept as a single endpoint (action-discriminated)
// rather than two, since both share the same borrowerIds validation and
// org-scoping and there's no reason to duplicate that.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_caseload')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'reassign' | 'sms';
    borrowerIds?: string[];
    assignedTo?: string | null;
    body?: string;
  };
  const borrowerIds = (body.borrowerIds ?? []).filter((id) => typeof id === 'string' && id.length > 0);
  if (borrowerIds.length === 0) return NextResponse.json({ error: 'borrowerIds required' }, { status: 400 });
  if (borrowerIds.length > MAX_BULK) return NextResponse.json({ error: `Select ${MAX_BULK} or fewer at a time.` }, { status: 400 });

  const sb = createAdminClient();

  if (body.action === 'reassign') {
    if (body.assignedTo) {
      const { data: agent } = await sb.from('profiles').select('id').eq('id', body.assignedTo).eq('org_id', orgId).maybeSingle();
      if (!agent) return NextResponse.json({ error: 'That agent was not found in this org.' }, { status: 400 });
    }
    const { error, count } = await sb
      .from('borrowers')
      .update({ assigned_agent_id: body.assignedTo ?? null })
      .eq('org_id', orgId)
      .in('id', borrowerIds)
      .select('id', { count: 'exact', head: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updated: count ?? borrowerIds.length });
  }

  if (body.action === 'sms') {
    const text = body.body?.trim();
    if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });

    const [{ data: profile }, { data: borrowers }] = await Promise.all([
      sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle(),
      sb.from('borrowers').select('id, phone, sms_consent, sms_opt_out').eq('org_id', orgId).in('id', borrowerIds),
    ]);

    const results: { borrowerId: string; status: 'sent' | 'skipped' | 'failed'; reason?: string }[] = [];
    for (const b of borrowers ?? []) {
      const id = b.id as string;
      if (!b.phone) { results.push({ borrowerId: id, status: 'skipped', reason: 'No phone on file' }); continue; }
      if (!b.sms_consent || b.sms_opt_out) { results.push({ borrowerId: id, status: 'skipped', reason: 'No SMS consent / opted out' }); continue; }

      const sent = await sendSms(b.phone as string, text);
      if (!sent.ok) { results.push({ borrowerId: id, status: 'failed', reason: sent.error }); continue; }

      await sb.from('sms_messages').insert({
        org_id: orgId, borrower_id: id, direction: 'outbound', body: text,
        to_number: b.phone, from_number: TWILIO_FROM, twilio_sid: sent.sid,
        status: 'sent', sent_by: profile?.id ?? null,
      });
      results.push({ borrowerId: id, status: 'sent' });
    }

    return NextResponse.json({ ok: true, results });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
});

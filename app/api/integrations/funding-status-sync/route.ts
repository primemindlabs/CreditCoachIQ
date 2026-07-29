import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Receives funding-status updates pushed from AshleyIQ/conduit-next after a
 * Stage 4 handoff — closes the loop that was previously one-directional
 * (CreditCoachIQ -> AshleyIQ only). Bearer-token authenticated with the
 * same shared secret as the original handoff (CONDUIT_STATUS_SYNC_KEY),
 * matching the reverse of conduit-next's credit-coach-handoff route.
 *
 * Matches the borrower via handoff_packages.conduit_lead_id (populated when
 * the original handoff succeeded, see app/api/journey/handoff), since
 * AshleyIQ doesn't know CreditCoachIQ's internal borrower_id directly.
 */
function isAuthorized(req: Request): boolean {
  const key = process.env.CONDUIT_STATUS_SYNC_KEY;
  if (!key) return false;
  return req.headers.get('authorization') === `Bearer ${key}`;
}

export const POST = withErrorHandling(async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    conduitLeadId?: string;
    borrowerId?: string; // preferred — CreditCoachIQ's own id, if AshleyIQ has it on file
    status?: 'pre_qual' | 'processing' | 'underwriting' | 'clear_to_close' | 'funded' | 'declined' | 'withdrawn';
  };
  if (!body.status) return NextResponse.json({ error: 'status is required' }, { status: 400 });
  if (!body.borrowerId && !body.conduitLeadId) return NextResponse.json({ error: 'borrowerId or conduitLeadId required' }, { status: 400 });

  const sb = createAdminClient();
  let borrowerId = body.borrowerId ?? null;

  if (!borrowerId && body.conduitLeadId) {
    const { data: pkg } = await sb
      .from('handoff_packages')
      .select('borrower_id')
      .eq('conduit_lead_id', body.conduitLeadId)
      .eq('status', 'sent')
      .order('sent_to_conduit_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    borrowerId = (pkg?.borrower_id as string) ?? null;
  }
  if (!borrowerId) return NextResponse.json({ error: 'Could not resolve a borrower for this update' }, { status: 404 });

  const { data: borrower } = await sb.from('borrowers').select('id, org_id').eq('id', borrowerId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });

  await sb.from('borrowers').update({ funding_status: body.status, funding_status_updated_at: new Date().toISOString() }).eq('id', borrowerId);
  await sb.from('handoff_packages').update({ last_status_sync_at: new Date().toISOString() }).eq('borrower_id', borrowerId).eq('org_id', borrower.org_id);

  await sb.from('coach_tasks').insert({
    org_id: borrower.org_id, borrower_id: borrowerId, source: 'system', type: 'funding_status_update',
    title: `Funding status updated: ${body.status.replace(/_/g, ' ')}`, due_date: new Date().toISOString().slice(0, 10),
  });

  return NextResponse.json({ ok: true });
});

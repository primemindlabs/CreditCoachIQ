import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { createDisputeForTradeline } from '@/lib/disputes/letters';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Draft dispute letters for a borrower's disputable tradelines (AI-drafted,
 * FCRA-compliant). This only creates credit_disputes rows with
 * response_status='pending' and no sent_at — nothing is mailed here.
 * A coach must separately review + call POST /api/disputes/send to mail
 * anything. Gated on the CROA disclosure already being signed.
 */
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { enrollmentId?: string; borrowerName?: string; borrowerAddress?: string; tradelineIds?: string[] };
  if (!body.enrollmentId || !body.borrowerName || !body.borrowerAddress) {
    return NextResponse.json({ error: 'enrollmentId, borrowerName, and borrowerAddress are required' }, { status: 400 });
  }

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id, croa_disclosure_signed_at')
    .eq('id', body.enrollmentId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
  if (!enrollment.croa_disclosure_signed_at) {
    return NextResponse.json({ error: 'CROA disclosure has not been signed for this client yet. Dispute letters cannot be generated until it is.' }, { status: 403 });
  }

  let query = sb
    .from('credit_tradelines')
    .select('id, creditor_name, account_number, dispute_reason, bureau')
    .eq('enrollment_id', body.enrollmentId)
    .eq('is_disputable', true)
    .in('dispute_status', ['identified', 'queued']);
  if (body.tradelineIds?.length) query = query.in('id', body.tradelineIds);
  const { data: tradelines } = await query.order('dispute_priority');

  if (!tradelines?.length) return NextResponse.json({ letters: [], count: 0 });

  const letters: Array<{ disputeId: string; bureau: string; creditor: string; letterBody: string }> = [];

  for (const tl of tradelines) {
    const bureaus = tl.bureau === 'all_three' ? ['experian', 'equifax', 'transunion'] : [tl.bureau as string];
    for (const bureau of bureaus) {
      const result = await createDisputeForTradeline(sb, {
        enrollmentId: body.enrollmentId,
        orgId,
        tradeline: { id: tl.id as string, creditor_name: tl.creditor_name as string, account_number: (tl.account_number as string) ?? null, dispute_reason: (tl.dispute_reason as string) ?? null },
        bureau,
        letterType: 'initial',
        cycleNumber: 1,
        borrowerName: body.borrowerName,
        borrowerAddress: body.borrowerAddress,
      });
      if (result) letters.push({ disputeId: result.id, bureau: result.bureau, creditor: result.creditor, letterBody: result.letterBody });
    }
    await sb.from('credit_tradelines').update({ dispute_status: 'queued' }).eq('id', tl.id);
  }

  return NextResponse.json({ letters, count: letters.length });
});

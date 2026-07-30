import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendCertifiedLetter } from '@/lib/disputes/lob';
import { getOrgBranding } from '@/lib/branding';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The explicit approval-to-mail step. A coach reviews AI-drafted letters
 * (app/api/disputes/generate) and only THIS call actually puts them in the
 * mail via Lob certified mail. This separation is intentional and
 * non-negotiable — AI drafts, a human approves and sends.
 */
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const { disputeIds } = (await req.json().catch(() => ({}))) as { disputeIds?: string[] };
  if (!disputeIds?.length) return NextResponse.json({ error: 'No disputes specified' }, { status: 400 });

  const { data: disputes } = await sb
    .from('credit_disputes')
    .select('id, tradeline_id, enrollment_id, bureau, letter_body, borrower_name, borrower_address, bureau_address')
    .in('id', disputeIds)
    .eq('org_id', orgId)
    .is('sent_at', null);

  if (!disputes?.length) return NextResponse.json({ error: 'No pending disputes found' }, { status: 404 });

  const branding = await getOrgBranding(orgId);
  const results: Array<{ disputeId: string; status: string; lobId?: string; error?: string }> = [];

  for (const dispute of disputes) {
    const send = await sendCertifiedLetter({
      description: `Credit Dispute, ${dispute.bureau}, ${(dispute.borrower_name as string) ?? 'Account'}`,
      borrowerName: dispute.borrower_name as string,
      borrowerAddress: dispute.borrower_address as string,
      bureauAddress: dispute.bureau_address as string,
      letterBody: dispute.letter_body as string,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      fromName: branding.fromName,
    });

    if (send.status === 'failed') {
      results.push({ disputeId: dispute.id as string, status: 'failed', error: send.error });
      continue;
    }

    const sentAt = new Date();
    await sb.from('credit_disputes').update({
      lob_letter_id: send.lobId,
      lob_status: send.status,
      sent_at: sentAt.toISOString(),
      approved_by_borrower_at: sentAt.toISOString(),
      approved_by: profile?.id ?? null,
      expected_response_by: new Date(sentAt.getTime() + 37 * 24 * 60 * 60 * 1000).toISOString(),
      response_status: 'awaiting_response',
    }).eq('id', dispute.id);

    await sb.from('credit_tradelines').update({ dispute_status: 'letter_sent' }).eq('id', dispute.tradeline_id);
    results.push({ disputeId: dispute.id as string, status: 'sent', lobId: send.lobId });
  }

  const sentCount = results.filter((r) => r.status === 'sent').length;
  if (sentCount > 0 && disputes[0]) {
    // Log a coach task as a lightweight activity record — no dedicated activity-log table on this side yet.
    const { data: enrollment } = await sb.from('credit_repair_enrollments').select('borrower_id').eq('id', disputes[0].enrollment_id).maybeSingle();
    if (enrollment?.borrower_id) {
      await sb.from('coach_tasks').insert({
        org_id: orgId, borrower_id: enrollment.borrower_id, assigned_to: profile?.id ?? null,
        source: 'system', type: 'dispute_response_tracking', title: `${sentCount} dispute letter(s) mailed, track bureau response`,
        due_date: new Date(Date.now() + 37 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }
  }

  return NextResponse.json({ results });
});

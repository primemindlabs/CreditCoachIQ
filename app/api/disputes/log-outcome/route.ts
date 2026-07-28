import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';
import { createDisputeForTradeline, type LetterType } from '@/lib/disputes/letters';
import { fireTrigger } from '@/lib/messaging/triggers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Log a bureau's response to a mailed dispute and auto-escalate: a
 * "verified accurate" or "no response" outcome automatically drafts the
 * next-cycle letter (method-of-verification, then CFPB complaint by cycle
 * 3) so a coach isn't manually re-triggering every follow-up round. Ported
 * from conduit-next's log-outcome route, adapted to fire the campaign
 * engine's 'dispute_response_received' trigger instead of notifyLO.
 */
export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { disputeId, outcome, enrollmentId } = (await req.json().catch(() => ({}))) as {
    disputeId?: string; outcome?: 'item_removed' | 'item_updated' | 'verified_accurate' | 'no_response'; enrollmentId?: string;
  };
  if (!disputeId || !outcome || !enrollmentId) return NextResponse.json({ error: 'disputeId, outcome, and enrollmentId are required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: dispute } = await sb
    .from('credit_disputes')
    .select('*, credit_tradelines(id, creditor_name, account_number, dispute_reason)')
    .eq('id', disputeId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!dispute) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tradeline = dispute.credit_tradelines as { id: string; creditor_name: string; account_number: string | null; dispute_reason: string | null } | null;

  let nextAction = '';
  let autoGenerateFollowUp = false;

  if (outcome === 'item_removed') {
    nextAction = 'This item was removed. The client\'s score should reflect it within 30-45 days.';
    await sb.from('credit_tradelines').update({ dispute_status: 'removed' }).eq('id', dispute.tradeline_id);
  } else if (outcome === 'verified_accurate') {
    autoGenerateFollowUp = true;
    await sb.from('credit_tradelines').update({ dispute_status: 'verified' }).eq('id', dispute.tradeline_id);
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: `A credit bureau responded "verified" to a dispute for ${tradeline?.creditor_name ?? 'an account'} (cycle ${dispute.cycle_number}). In 2 sentences, explain the best next step in plain language, for the coach's internal notes.` }],
      });
      const b = resp.content[0];
      nextAction = b.type === 'text' ? b.text.trim() : '';
    } catch {
      nextAction = 'The bureau verified the item. Escalating with a method-of-verification demand.';
    }
  } else if (outcome === 'no_response') {
    autoGenerateFollowUp = true;
    nextAction = 'No bureau response within 30 days. Under the FCRA they must remove unverified items — sending a follow-up.';
  } else {
    nextAction = 'Bureau response logged.';
  }

  await sb.from('credit_disputes').update({
    response_status: outcome, borrower_outcome: outcome, response_logged_at: new Date().toISOString(), ai_next_action: nextAction,
  }).eq('id', disputeId);

  const { data: enrollment } = await sb.from('credit_repair_enrollments').select('borrower_id').eq('id', enrollmentId).maybeSingle();
  if (enrollment?.borrower_id) {
    void fireTrigger(orgId, 'dispute_response_received', { borrowerId: enrollment.borrower_id as string });
  }

  let nextDisputeId: string | null = null;
  if (autoGenerateFollowUp && tradeline) {
    const nextCycle = (dispute.cycle_number as number) + 1;
    const nextType: LetterType = nextCycle >= 3 ? 'cfpb_complaint' : 'method_of_verification';
    const result = await createDisputeForTradeline(sb, {
      enrollmentId, orgId, tradeline, bureau: dispute.bureau as string, letterType: nextType, cycleNumber: nextCycle,
      borrowerName: dispute.borrower_name as string, borrowerAddress: dispute.borrower_address as string,
      previousResponse: outcome === 'no_response' ? 'No response received within the statutory 30-day window.' : 'Bureau claimed the item was verified as accurate.',
    });
    if (result) {
      nextDisputeId = result.id;
      await sb.from('credit_disputes').update({ auto_next_letter_id: result.id }).eq('id', disputeId);
      await sb.from('credit_tradelines').update({ dispute_status: 'queued' }).eq('id', tradeline.id);
    }
  }

  return NextResponse.json({ nextAction, nextDisputeId });
}

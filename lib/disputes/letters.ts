/**
 * Dispute-letter generation (Claude Haiku) + shared helper to create a
 * dispute record. Ported from conduit-next's lib/credit-repair/letters.ts —
 * unchanged logic, borrower-centric naming only.
 *
 * Human-in-the-loop, non-negotiable: this only DRAFTS letters into
 * credit_disputes with response_status='pending' and no sent_at. Nothing
 * here mails anything — see lib/disputes/lob.ts + app/api/disputes/send for
 * the separate, explicit approval-to-mail step.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

export const BUREAU_ADDRESSES: Record<string, { name: string; address: string }> = {
  experian: { name: 'Experian Information Solutions', address: 'P.O. Box 4500\nAllen, TX 75013' },
  equifax: { name: 'Equifax Information Services LLC', address: 'P.O. Box 740256\nAtlanta, GA 30374' },
  transunion: { name: 'TransUnion LLC Consumer Dispute Center', address: 'P.O. Box 2000\nChester, PA 19016' },
};

export type LetterType = 'initial' | 're_dispute' | 'method_of_verification' | 'cfpb_complaint' | 'goodwill' | 'pay_for_delete';

export async function generateDisputeLetter(params: {
  borrowerName: string;
  borrowerAddress: string;
  bureau: string;
  creditorName: string;
  accountNumber: string | null;
  disputeReason: string;
  letterType: LetterType;
  cycleNumber: number;
  previousResponse?: string;
}): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Generate a professional, FCRA-compliant credit dispute letter. Letter type: ${params.letterType}. Cycle: ${params.cycleNumber}.
${params.previousResponse ? `Previous bureau response: ${params.previousResponse}` : ''}

Borrower: ${params.borrowerName}
Borrower address: ${params.borrowerAddress}
Bureau: ${params.bureau}
Creditor/Account: ${params.creditorName}${params.accountNumber ? ` (last 4: ${params.accountNumber})` : ''}
Dispute reason: ${params.disputeReason}

Write a complete, formal dispute letter following FCRA 15 U.S.C. §1681i requirements. Include:
- Date, borrower address, bureau address
- Clear statement this is a formal dispute under the FCRA
- Specific account information and nature of dispute
- Request for investigation and removal/correction
- Statement of rights if not resolved within 30 days
- ${params.letterType === 'method_of_verification' ? 'Demand for method of verification documentation under FCRA §1681i(a)(7)' : ''}
- ${params.letterType === 'cfpb_complaint' ? 'Notice of intent to file CFPB complaint if not resolved' : ''}
- Professional closing

Return only the letter text, no commentary.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

interface TradelineLike {
  id: string;
  creditor_name: string;
  account_number: string | null;
  dispute_reason: string | null;
}

/** Generates a letter and inserts a credit_disputes row (draft — not sent). Returns { id, letterBody }. */
export async function createDisputeForTradeline(
  sb: SupabaseClient,
  args: {
    enrollmentId: string;
    orgId: string;
    tradeline: TradelineLike;
    bureau: string;
    letterType: LetterType;
    cycleNumber: number;
    borrowerName: string;
    borrowerAddress: string;
    previousResponse?: string;
  }
): Promise<{ id: string; bureau: string; creditor: string; letterBody: string } | null> {
  const bureauInfo = BUREAU_ADDRESSES[args.bureau];
  if (!bureauInfo) return null;

  const letterBody = await generateDisputeLetter({
    borrowerName: args.borrowerName,
    borrowerAddress: args.borrowerAddress,
    bureau: args.bureau,
    creditorName: args.tradeline.creditor_name,
    accountNumber: args.tradeline.account_number,
    disputeReason: args.tradeline.dispute_reason ?? 'This account contains inaccurate information.',
    letterType: args.letterType,
    cycleNumber: args.cycleNumber,
    previousResponse: args.previousResponse,
  });

  const { data: dispute, error } = await sb
    .from('credit_disputes')
    .insert({
      enrollment_id: args.enrollmentId,
      tradeline_id: args.tradeline.id,
      org_id: args.orgId,
      bureau: args.bureau,
      cycle_number: args.cycleNumber,
      letter_type: args.letterType,
      letter_body: letterBody,
      borrower_name: args.borrowerName,
      borrower_address: args.borrowerAddress,
      bureau_address: `${bureauInfo.name}\n${bureauInfo.address}`,
      response_status: 'pending',
    })
    .select('id')
    .single();

  if (error || !dispute) return null;
  return { id: dispute.id as string, bureau: args.bureau, creditor: args.tradeline.creditor_name, letterBody };
}

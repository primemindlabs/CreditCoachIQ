/**
 * Auto-draft a warm re-engagement message the instant a credit alert lands.
 * Claude Haiku. White-labeled as the agent; never mentions credit monitoring
 * or competitors. Financial figures left as [placeholders] (compliance-safe).
 * (Ported unchanged from conduit-next.)
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export interface ReengagementDraft { sms: string; email_subject: string; email_body: string }

const SYSTEM = `You are a mortgage loan officer writing to a borrower. Write a short, warm, gently urgent (not desperate) re-engagement message. Tone: genuine, personal, brief — like a text from a trusted advisor, not a sales pitch. Do NOT mention competitor lenders, credit monitoring, or that you received any alert. DO convey timely care and a clear call to action. Never state a specific rate/APR/payment — use [bracketed placeholders]. Output EXACTLY three labeled sections:\nSMS: <under 160 chars>\nSUBJECT: <email subject>\nEMAIL: <4-6 sentences>`;

function reason(alertType: string, scoreDelta: number): string {
  if (alertType === 'score_increase') return `The borrower's credit score just improved by about ${Math.abs(scoreDelta)} points — they may qualify for a better rate than first quoted. Be the first to call with good news.`;
  if (alertType === 'score_decrease') return `The borrower's credit score dipped. Check in supportively, stay in their corner, offer to look at options. Do not alarm them.`;
  return `The borrower may be shopping around and hasn't committed yet. Re-engage warmly, remind them you're their best option, create gentle urgency around timing and rates.`;
}

export async function generateReengagementDraft(opts: { alertType: string; scoreDelta: number; firstName: string; loanSummary?: string | null }): Promise<ReengagementDraft> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const user = `Borrower first name: ${opts.firstName}\n${opts.loanSummary ? `Loan scenario: ${opts.loanSummary}\n` : ''}Situation: ${reason(opts.alertType, opts.scoreDelta)}`;
  const msg = await anthropic.messages.create({ model: 'claude-haiku-4-5', max_tokens: 450, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';

  const grab = (label: string, next: string) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\n${next}:|$)`, 'i');
    return (text.match(re)?.[1] ?? '').trim();
  };
  return {
    sms: grab('SMS', 'SUBJECT') || `Hi ${opts.firstName}, it's a great time to revisit your loan — do you have a few minutes to connect today?`,
    email_subject: grab('SUBJECT', 'EMAIL') || `${opts.firstName}, a quick update on your loan`,
    email_body: grab('EMAIL', 'ZZZ') || text,
  };
}

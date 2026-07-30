/**
 * AI-generated, coach-facing consultation prep brief. Claude Haiku, same
 * pattern as lib/creditAlerts/rateReengagement.ts. This text is for the
 * COACH to read before the call, not shown verbatim to the client — keep it
 * practical and direct, not marketing copy.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { PlanTier } from '@/lib/plans';

const SYSTEM = `You are helping a credit and financial coach prepare for a client's first consultation call. Given the client's intake quiz answers, write a concise (4-6 sentence) internal prep brief covering: (1) their stated goal, (2) their credit situation as self-reported, (3) the recommended plan tier and a one-line reason why, and (4) one or two suggested opening questions or talking points for the coach. Plain, practical, coach-facing tone, this is a work note, not client-facing copy. Do not give specific investment, securities, or legal advice; stay in the lane of credit and budgeting fundamentals. Output plain text, no headers or bullet formatting. Never use an em dash (—); use a period or comma instead.`;

export async function generateQuizSummary(opts: {
  firstName: string;
  primaryGoal: string | null;
  selfReportedScore: number | null;
  goalNotes: string | null;
  recommendedTier: PlanTier;
  answersSummary: string; // human-readable dump of the other answers for context
}): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const user = [
    `Client first name: ${opts.firstName}`,
    opts.primaryGoal ? `Stated primary goal: ${opts.primaryGoal}` : null,
    opts.selfReportedScore != null ? `Self-reported credit score: ${opts.selfReportedScore}` : 'Self-reported credit score: not provided',
    `Recommended plan tier (scored deterministically, not by you): ${opts.recommendedTier}`,
    opts.goalNotes ? `Client's own notes: "${opts.goalNotes}"` : null,
    `Other quiz answers:\n${opts.answersSummary}`,
  ].filter(Boolean).join('\n');

  try {
    const msg = await anthropic.messages.create({ model: 'claude-haiku-4-5', max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: user }] });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    return text || fallback(opts.firstName, opts.recommendedTier);
  } catch (err) {
    console.error('[quiz] AI summary generation failed:', err instanceof Error ? err.message : err);
    return fallback(opts.firstName, opts.recommendedTier);
  }
}

function fallback(firstName: string, tier: PlanTier): string {
  return `${firstName} completed the intake quiz. Scored toward the "${tier}" path. Review their answers directly before the call (AI summary unavailable).`;
}

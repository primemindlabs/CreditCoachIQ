/**
 * Pre-call prep brief — coach-facing, extends the same pattern
 * lib/quiz/summarize.ts established for the first intake call to every
 * subsequent scheduled call. Grounded only in current score/dispute/
 * stacking data passed in.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are writing a short internal prep note for a credit and financial coach about to call a client. Ground it ONLY in the data provided — current scores, dispute activity, stacking progress, journey stage. 3-5 sentences, practical and direct, coach-facing (this is a work note, not client-facing copy). Suggest 1-2 talking points genuinely relevant to their current situation (e.g. a stalled dispute worth a status update, a score milestone worth acknowledging, a stage that's been stagnant). No legal, investment, or tax advice. Plain text, no headers or bullets.`;

export async function generateCallPrepBrief(opts: {
  firstName: string;
  journeyStage: string;
  planTier: string;
  daysInStage: number;
  currentScore: number | null;
  targetScore: number | null;
  openDisputeCount: number;
  recentDisputeOutcomes: string[];
  stackedCapital: number;
  activeApplicationCount: number;
}): Promise<string> {
  const lines = [
    `Client: ${opts.firstName}`,
    `Plan: ${opts.planTier}. Journey stage: ${opts.journeyStage} (${opts.daysInStage} days in this stage).`,
    `Score: ${opts.currentScore ?? 'unknown'}, target ${opts.targetScore ?? 'unknown'}.`,
    `Open disputes: ${opts.openDisputeCount}.`,
    opts.recentDisputeOutcomes.length ? `Recent dispute outcomes: ${opts.recentDisputeOutcomes.join('; ')}.` : 'No recent dispute outcomes.',
    `Stacked capital: $${opts.stackedCapital.toLocaleString()} across ${opts.activeApplicationCount} active line(s).`,
  ];

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 350,
      system: SYSTEM,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    return text || fallback(opts.firstName);
  } catch (err) {
    console.error('[ai] call prep brief failed:', err instanceof Error ? err.message : err);
    return fallback(opts.firstName);
  }
}

function fallback(firstName: string): string {
  return `Review ${firstName}'s current score, open disputes, and stacking progress on this page before the call (AI summary unavailable).`;
}

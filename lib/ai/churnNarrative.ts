/**
 * Explains WHY a client's churn-risk score is what it is, reasoning over
 * their actual activity timeline — not a replacement for computeChurnRisk
 * (lib/analytics/churnRisk.ts), a narrative layer on top of it. The
 * deterministic score/level/reasons stay the auditable primary signal (that
 * file's own doc comment is explicit that a churn number needs to be
 * explainable by a coach without an AI call); this connects that score to
 * specific real events — "risk is elevated mainly because of two payment
 * failures and no coach contact in 18 days," not just a generic score.
 * Same fallback-on-failure convention as the rest of lib/ai/*.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are explaining a client's churn-risk assessment to their credit coach. You're given a deterministic risk score/level/reasons (already computed, trust it as ground truth) and their recent activity timeline. Ground every claim ONLY in the specific activity events listed, reference actual events (e.g. "the payment failure on [date]," "no contact since [date]") rather than generic statements. If the deterministic reasons already explain most of it, say so briefly rather than padding. If the activity timeline surfaces something the deterministic score wouldn't have caught (e.g. a string of unanswered outbound calls, or a sudden stage change right before the risk period), call it out, that's the value of this narrative over the raw score. 2-4 sentences, plain text, no headers or bullets, coach-facing internal note. Never use an em dash (—); use a period or comma instead.`;

interface ActivityInput {
  type: string;
  label: string;
  detail: string | null;
  createdAt: string;
}

export async function generateChurnNarrative(opts: {
  firstName: string;
  score: number;
  level: 'low' | 'medium' | 'high';
  reasons: string[];
  activity: ActivityInput[];
}): Promise<string> {
  const lines = [
    `Client: ${opts.firstName}`,
    `Deterministic risk: ${opts.level} (score ${opts.score}/100). Reasons: ${opts.reasons.length ? opts.reasons.join(', ') : 'none flagged'}.`,
    'Recent activity (most recent first):',
    ...opts.activity.slice(0, 20).map((a) => `- [${new Date(a.createdAt).toLocaleDateString()}] ${a.label}${a.detail ? `: ${a.detail}` : ''}`),
  ];

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    return text || fallback(opts.level, opts.reasons);
  } catch (err) {
    console.error('[ai] churn narrative failed:', err instanceof Error ? err.message : err);
    return fallback(opts.level, opts.reasons);
  }
}

function fallback(level: string, reasons: string[]): string {
  return reasons.length
    ? `${level} risk, driven by: ${reasons.join(', ')} (AI narrative unavailable).`
    : `${level} risk (AI narrative unavailable).`;
}

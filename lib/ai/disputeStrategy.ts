/**
 * Coach-facing dispute strategy summary — narrates the priority order that
 * lib/creditReport/parse.ts already assigned to each tradeline (is_disputable
 * / dispute_reason / dispute_priority / estimated_score_gain) at upload time.
 * This is deliberately a narrative layer over an existing deterministic
 * signal, not a new scoring pass — same posture as churnRisk's AI narrative:
 * the priority/reason/gain numbers are the audit trail, this just explains
 * them in plain language so a coach can decide what to send without reading
 * every row individually. Same fallback-on-failure pattern as the rest of
 * lib/ai/* — never blocks the tradeline list from rendering.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are a credit repair strategist writing a short internal note for a coach reviewing which tradelines to dispute for a client. Ground every sentence ONLY in the tradelines listed — never invent a creditor, balance, or reason not given. Recommend a sending order (highest-value / most legally solid disputes first), and call out anything worth flagging to the coach (e.g. two items likely from the same root cause, or a low-confidence flag worth a second look before sending). 3-5 sentences, plain text, no headers or bullets, coach-facing internal note not client-facing copy. No legal guarantees — dispute outcomes are never certain.`;

interface TradelineInput {
  creditorName: string;
  bureau: string;
  disputeReason: string | null;
  disputePriority: number | null;
  estimatedScoreGain: number | null;
}

export async function generateDisputeStrategy(opts: {
  firstName: string;
  tradelines: TradelineInput[];
}): Promise<string> {
  if (opts.tradelines.length === 0) return `No disputable items flagged on ${opts.firstName}'s current report.`;

  const lines = [
    `Client: ${opts.firstName}`,
    `Disputable tradelines (${opts.tradelines.length}), in priority order as flagged:`,
    ...opts.tradelines.map((t, i) =>
      `${i + 1}. ${t.creditorName} (${t.bureau}) — priority ${t.disputePriority ?? '?'}/10, est. score gain +${t.estimatedScoreGain ?? '?'}, reason: ${t.disputeReason ?? 'not specified'}`
    ),
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
    return text || fallback(opts.firstName, opts.tradelines.length);
  } catch (err) {
    console.error('[ai] dispute strategy failed:', err instanceof Error ? err.message : err);
    return fallback(opts.firstName, opts.tradelines.length);
  }
}

function fallback(firstName: string, count: number): string {
  return `${count} disputable item(s) flagged on ${firstName}'s report, sorted by priority below (AI summary unavailable — review each item's reason and estimated score gain directly).`;
}

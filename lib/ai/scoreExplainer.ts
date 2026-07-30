/**
 * "Why did this happen" score-change explainer — client-facing (unlike the
 * coach-facing briefs elsewhere in lib/ai), so tone matters: plain,
 * encouraging, grounded only in the client's own resolved disputes in that
 * window. Never invents a reason; if there's no dispute activity to point
 * to, says so honestly rather than guessing.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are writing a short, warm, plain-English explanation for a credit-repair client about why their credit score changed. Ground your answer ONLY in the resolved dispute activity provided, do not speculate about causes not listed. If no dispute activity is provided, say the change likely reflects normal score movement (payment history, utilization, etc.) and that they can ask their coach for specifics. 2-3 sentences maximum. Encouraging but honest tone, second person ("you"), no financial or legal advice beyond credit-repair basics. Never use an em dash (—); use a period or comma instead.`;

export async function explainScoreChange(opts: {
  firstName: string;
  previousScore: number;
  latestScore: number;
  resolvedDisputes: { creditorName: string; outcome: string }[];
}): Promise<string> {
  const delta = opts.latestScore - opts.previousScore;
  const direction = delta >= 0 ? 'increased' : 'decreased';
  const disputeLines = opts.resolvedDisputes.length
    ? opts.resolvedDisputes.map((d) => `- ${d.creditorName}: ${d.outcome.replace('_', ' ')}`).join('\n')
    : 'None on file for this window.';

  const user = `Client: ${opts.firstName}\nPrevious score: ${opts.previousScore}\nLatest score: ${opts.latestScore}\nScore ${direction} by ${Math.abs(delta)} points.\nResolved dispute activity in this window:\n${disputeLines}`;

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    return text || fallback(direction, opts.resolvedDisputes.length);
  } catch (err) {
    console.error('[ai] score explanation failed:', err instanceof Error ? err.message : err);
    return fallback(direction, opts.resolvedDisputes.length);
  }
}

function fallback(direction: string, disputeCount: number): string {
  return disputeCount > 0
    ? `Your score ${direction}. ${disputeCount} resolved dispute${disputeCount === 1 ? '' : 's'} likely contributed. Ask your coach for the specifics.`
    : `Your score ${direction}. This can reflect normal factors like payment history or utilization. Ask your coach if you'd like the specifics.`;
}

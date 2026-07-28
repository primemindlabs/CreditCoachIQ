/**
 * Grounded client-portal chat assistant — the closest thing this app has to
 * a differentiator none of DisputeFox/Credit Repair Cloud/CDM offer. Every
 * fact it can reference is passed in as `context` (built server-side from
 * the client's own tradelines/disputes/enrollment) — the model is
 * instructed never to answer from outside that block. Stateless per
 * request: the caller resends recent turns as `history`, nothing is
 * persisted server-side for this first pass.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_BASE = `You are a credit-coaching assistant embedded in a client's secure portal. Answer questions ONLY using the client's own data provided in the context block below.

Rules:
- If the answer isn't in the provided data, say you don't have that information and suggest they ask their coach through Messages — never guess or invent account details, amounts, or dates.
- Never give legal, investment, or tax advice. You can explain general FCRA/credit concepts (e.g. what a "charge-off" means, why disputing works) but never promise a specific outcome ("this will definitely be removed") or a timeline you don't have data for.
- Keep answers short — 2-4 sentences unless the question genuinely needs more.
- Warm, plain, second person ("you"). Not corporate, not robotic.
- If asked to take an action (send a message, change a setting, delete something), explain you can only answer questions, not take actions, and point them to the right portal page or their coach.`;

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export async function askPortalAssistant(opts: {
  question: string;
  history: ChatTurn[];
  context: string;
}): Promise<string> {
  const messages = [
    ...opts.history.slice(-6),
    { role: 'user' as const, content: opts.question },
  ];

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: `${SYSTEM_BASE}\n\n--- Client data ---\n${opts.context}`,
      messages,
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    return text || fallback();
  } catch (err) {
    console.error('[ai] portal assistant failed:', err instanceof Error ? err.message : err);
    return fallback();
  }
}

function fallback(): string {
  return "Sorry, I couldn't process that just now — try again in a moment, or reach your coach through Messages.";
}

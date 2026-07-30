/**
 * Monthly spending digest — client-facing. Turns the raw Plaid transaction
 * list (already in the portal, just listed with zero interpretation) into
 * 1-2 real, grounded observations tied to a goal when relevant. Every claim
 * must trace back to a transaction actually provided — no invented
 * categories, amounts, or trends.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are a financial coach's assistant writing a brief, encouraging spending digest for a client, based on their real recent bank transactions and financial goals. Identify 1-2 real, notable patterns from the transaction data provided (a category that shows up often, a large or recurring expense) and connect it plainly to progress toward one of their stated goals if relevant. Ground every claim ONLY in the transactions provided, never invent a category, amount, or trend not present in the data. 2-4 sentences. Plain, second person ("you"), no judgment or shaming tone, no specific investment advice. Never use an em dash (—); use a period or comma instead.`;

export async function generateSpendingDigest(opts: {
  firstName: string;
  transactions: { merchantName: string | null; category: string | null; amount: number; postedAt: string }[];
  goals: { title: string; targetAmount: number | null; currentAmount: number }[];
}): Promise<string> {
  if (opts.transactions.length === 0) {
    return 'No transactions yet. Once a few come in after linking your bank, spending insights will show up here.';
  }

  const txLines = opts.transactions
    .slice(0, 40)
    .map((t) => `${t.postedAt.slice(0, 10)} | ${t.category ?? 'uncategorized'} | ${t.merchantName ?? 'transaction'} | $${t.amount.toFixed(2)}`)
    .join('\n');
  const goalLines = opts.goals.length
    ? opts.goals.map((g) => `${g.title}: $${g.currentAmount} of ${g.targetAmount ? `$${g.targetAmount}` : 'no target set'}`).join('\n')
    : 'No goals set yet.';

  const user = `Client: ${opts.firstName}\nRecent transactions (most recent first):\n${txLines}\n\nGoals:\n${goalLines}`;

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    return text || fallback();
  } catch (err) {
    console.error('[ai] spending digest failed:', err instanceof Error ? err.message : err);
    return fallback();
  }
}

function fallback(): string {
  return 'Your recent transactions are in. Check the list below for the details. AI insights are temporarily unavailable.';
}

/**
 * Coach-facing morning briefing — narrates the same real data already
 * rendered as raw lists on the Today page (/api/coach/today). This is a
 * summary layer over real numbers, not a separate data source — every
 * figure it references is passed in below.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are writing a one-paragraph morning briefing for a credit-repair coach, summarizing what needs their attention today. Ground every sentence ONLY in the counts and names provided — never invent a number or a client name not given. Prioritize by urgency: payment failures and complaints approaching escalation first, then calls and messages, then good news (score jumps) last as a positive note. 3-5 sentences, direct and practical, no headers or bullets, plain text. If everything is genuinely empty, say so briefly and positively.`;

export async function generateTodayBriefing(opts: {
  openTaskCount: number;
  upcomingCallCount: number;
  unreadMessageCount: number;
  openComplaints: { name: string; category: string; status: string }[];
  paymentFailures: { name: string; retryCount: number }[];
  scoreJumps: { name: string; delta: number }[];
}): Promise<string> {
  const total = opts.openTaskCount + opts.upcomingCallCount + opts.unreadMessageCount + opts.openComplaints.length + opts.paymentFailures.length;
  if (total === 0 && opts.scoreJumps.length === 0) {
    return "Nothing needs your attention right now — caseload's quiet.";
  }

  const lines = [
    `Open tasks: ${opts.openTaskCount}`,
    `Calls scheduled this week: ${opts.upcomingCallCount}`,
    `Unread client messages: ${opts.unreadMessageCount}`,
    opts.openComplaints.length ? `Open complaints: ${opts.openComplaints.map((c) => `${c.name} (${c.category.replace('_', ' ')}, ${c.status.replace('_', ' ')})`).join('; ')}` : 'Open complaints: none',
    opts.paymentFailures.length ? `Payment failures: ${opts.paymentFailures.map((p) => `${p.name} (${p.retryCount} attempt${p.retryCount === 1 ? '' : 's'})`).join('; ')}` : 'Payment failures: none',
    opts.scoreJumps.length ? `Notable score jumps this week: ${opts.scoreJumps.map((s) => `${s.name} +${s.delta}`).join('; ')}` : 'Notable score jumps: none',
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
    return text || fallback(total);
  } catch (err) {
    console.error('[ai] today briefing failed:', err instanceof Error ? err.message : err);
    return fallback(total);
  }
}

function fallback(total: number): string {
  return `${total} item${total === 1 ? '' : 's'} need your attention today — see the sections below for details (AI summary temporarily unavailable).`;
}

/**
 * Message-copy drafting — closes the gap MIGRATION_NOTES.md flagged
 * explicitly ("no Haiku-drafting endpoint for message copy yet, mirrors
 * the dispute-letter AI-drafting pattern already in Module B, just not
 * extended here"). Same drafts-then-a-human-reviews posture as the
 * dispute-letter drafter: this fills the form, it doesn't send anything.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

// Must match lib/messaging/context.ts's buildMessageContext() exactly —
// these are the only tokens that will actually resolve at send time.
const VALID_TOKENS = ['first_name', 'last_name', 'coach_first_name', 'current_score', 'target_score', 'stacked_capital', 'journey_stage_label', 'unsubscribe_url'];

const SYSTEM = `You are drafting an email or SMS template for a credit-repair and financial coaching CRM's automated campaign system. Write copy for the purpose the coach describes.

You may ONLY use these personalization tokens, written exactly as shown: ${VALID_TOKENS.map((t) => `{{${t}}}`).join(', ')}. Never invent a token that isn't in this list.

For email: output the subject line first, prefixed exactly "Subject: ", then a blank line, then the body.
For SMS: output only the body, no subject, and keep it under 320 characters.

Warm, encouraging, specific to credit coaching, not generic corporate marketing copy. If the purpose implies a marketing-style (non-transactional) message, include {{unsubscribe_url}} somewhere in the body.

Never use an em dash (—) anywhere in the copy. Use a period, comma, or "and" instead.`;

export async function draftMessageCopy(opts: {
  purpose: string;
  channel: 'email' | 'sms';
}): Promise<{ subject: string | null; body: string }> {
  const user = `Channel: ${opts.channel}\nPurpose: ${opts.purpose}`;

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    const block = msg.content[0];
    const raw = block?.type === 'text' ? block.text.trim() : '';
    if (!raw) return fallback(opts.channel);

    if (opts.channel === 'email' && raw.toLowerCase().startsWith('subject:')) {
      const [firstLine, ...rest] = raw.split('\n');
      return { subject: firstLine.replace(/^subject:\s*/i, '').trim(), body: rest.join('\n').trim() };
    }
    return { subject: null, body: raw };
  } catch (err) {
    console.error('[ai] template draft failed:', err instanceof Error ? err.message : err);
    return fallback(opts.channel);
  }
}

function fallback(channel: 'email' | 'sms'): { subject: string | null; body: string } {
  return {
    subject: channel === 'email' ? 'A quick update, {{first_name}}' : null,
    body: 'Draft generation is temporarily unavailable. Try again in a moment, or write this one by hand.',
  };
}

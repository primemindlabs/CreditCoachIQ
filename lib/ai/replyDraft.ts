/**
 * Draft-reply suggestion for a coach replying to a client on SMS or the
 * portal message thread — same lib/ai/* pattern as the rest of this
 * directory (Haiku, grounded-in-provided-data system prompt, deterministic
 * fallback on failure). This is explicitly a DRAFT: the coach edits and
 * sends it themselves, nothing here ever sends a message on its own.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are drafting a reply for a credit and financial coach to send to their client, on the coach's behalf for them to review and edit before sending. Ground the reply ONLY in the conversation provided — never invent facts about the client's account, score, or situation that aren't in the thread. Match the tone of the coach's own prior messages in the thread if any are present; otherwise warm, direct, and professional. Keep it appropriately short for the channel (SMS: 1-2 sentences; portal message: up to a short paragraph). No legal, investment, or tax advice — if the client is asking something that needs that, draft a reply that offers to discuss it on a call instead of answering it directly. Output ONLY the reply text itself, nothing else — no preamble, no quotes around it, no "Here's a draft:".`;

interface ThreadMessage {
  from: 'coach' | 'client';
  body: string;
}

export async function generateReplyDraft(opts: {
  channel: 'sms' | 'portal';
  firstName: string;
  thread: ThreadMessage[];
}): Promise<string> {
  if (opts.thread.length === 0) return '';

  const lines = [
    `Client: ${opts.firstName}`,
    `Channel: ${opts.channel === 'sms' ? 'SMS text message' : 'secure portal message'}`,
    'Conversation so far (oldest first):',
    ...opts.thread.slice(-12).map((m) => `${m.from === 'coach' ? 'Coach' : opts.firstName}: ${m.body}`),
    'Draft the coach\'s next reply.',
  ];

  try {
    const msg = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      system: SYSTEM,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    return text;
  } catch (err) {
    console.error('[ai] reply draft failed:', err instanceof Error ? err.message : err);
    return '';
  }
}

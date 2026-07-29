import twilio from 'twilio';

let client: ReturnType<typeof twilio> | null = null;

export function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not set.');
  if (!client) client = twilio(sid, token);
  return client;
}

// .env.example defines TWILIO_FROM_NUMBER — keep this in sync with that name.
export const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER ?? '';

// Generic outbound send, used by the coach-facing SMS thread (two-way
// messaging) — distinct from the one-off invite senders (lib/quiz/sendInvite,
// lib/messaging/enroll) which have their own message content baked in.
export async function sendSms(to: string, body: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  if (!TWILIO_FROM) return { ok: false, error: 'TWILIO_FROM_NUMBER is not set.' };
  try {
    const msg = await getTwilio().messages.create({ to, from: TWILIO_FROM, body });
    return { ok: true, sid: msg.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Twilio SMS send failed' };
  }
}

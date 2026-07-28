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

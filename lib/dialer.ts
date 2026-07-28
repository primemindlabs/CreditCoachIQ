/**
 * Click-to-call dialer. A coach clicks "Call" next to a client — Twilio
 * calls the coach's own phone first; once the coach picks up, Twilio bridges
 * them to the client's number (app/api/telephony/twiml). No recording by
 * default: recording-consent requirements vary by state (many are two-party
 * consent), so that would need its own explicit consent-capture flow before
 * being safe to turn on, not something to default to.
 */
import 'server-only';
import { getTwilio, TWILIO_FROM } from '@/lib/sms';

export async function initiateClickToCall(params: {
  coachPhone: string;
  clientPhone: string;
  baseUrl: string;
}): Promise<{ ok: true; callSid: string } | { ok: false; error: string }> {
  if (!TWILIO_FROM) return { ok: false, error: 'TWILIO_FROM_NUMBER is not set.' };

  try {
    const twiml = new URL(`${params.baseUrl.replace(/\/$/, '')}/api/telephony/twiml`);
    twiml.searchParams.set('to', params.clientPhone);

    const statusCallback = `${params.baseUrl.replace(/\/$/, '')}/api/telephony/status`;

    const call = await getTwilio().calls.create({
      to: params.coachPhone,
      from: TWILIO_FROM,
      url: twiml.toString(),
      statusCallback,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
    });

    return { ok: true, callSid: call.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Twilio call failed' };
  }
}

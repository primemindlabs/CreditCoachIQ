import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Twilio's call-status callback — signature-verified per Twilio's own spec
// (same pattern as app/api/webhooks/calendly's HMAC verification, adapted to
// Twilio's request-signing scheme). Updates the call_logs row created when
// the call was initiated.
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get('x-twilio-signature');
  const url = req.url;
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => { params[key] = String(value); });

  if (authToken && signature) {
    const valid = twilio.validateRequest(authToken, signature, url, params);
    if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const callSid = params.CallSid;
  const status = params.CallStatus; // queued, ringing, in-progress, completed, busy, failed, no-answer, canceled
  const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : null;
  if (!callSid) return NextResponse.json({ ok: true });

  const sb = createAdminClient();
  const patch: Record<string, unknown> = { status: status ?? 'initiated' };
  if (duration !== null) patch.duration_seconds = duration;
  if (status === 'completed' || status === 'busy' || status === 'failed' || status === 'no-answer' || status === 'canceled') {
    patch.ended_at = new Date().toISOString();
  }

  await sb.from('call_logs').update(patch).eq('twilio_call_sid', callSid);

  return NextResponse.json({ ok: true });
}

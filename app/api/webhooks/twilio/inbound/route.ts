import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function last10Digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

// Twilio's inbound-SMS webhook — signature-verified, same pattern as
// app/api/telephony/status. There's one shared TWILIO_FROM_NUMBER for the
// whole install (single-operator platform, see FEATURES.md), so the org is
// resolved from whichever borrower's phone number matches the sender, not
// from the destination number.
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

  const from = params.From;
  const to = params.To;
  const body = params.Body ?? '';
  const messageSid = params.MessageSid;
  if (!from || !messageSid) return NextResponse.json({ ok: true });

  const sb = createAdminClient();
  const incomingDigits = last10Digits(from);

  const { data: candidates } = await sb.from('borrowers').select('id, org_id, phone, assigned_agent_id, first_name, last_name, lead_status').not('phone', 'is', null);
  const borrower = (candidates ?? []).find((b) => last10Digits((b.phone as string) ?? '') === incomingDigits && incomingDigits.length === 10);

  if (!borrower) {
    // No matching client — nothing to log against. Twilio still needs 200 OK.
    return NextResponse.json({ ok: true });
  }

  await sb.from('sms_messages').insert({
    org_id: borrower.org_id,
    borrower_id: borrower.id,
    direction: 'inbound',
    body,
    to_number: to ?? '',
    from_number: from,
    twilio_sid: messageSid,
    status: 'received',
  });

  await sb.from('coach_tasks').insert({
    org_id: borrower.org_id,
    borrower_id: borrower.id,
    assigned_to: (borrower.assigned_agent_id as string) ?? null,
    source: 'system',
    type: 'sms_reply',
    title: `${borrower.first_name} ${borrower.last_name} replied by text`,
  });

  if (borrower.lead_status && borrower.lead_status !== 'converted') {
    await sb.from('lead_activity_log').insert({
      org_id: borrower.org_id, borrower_id: borrower.id, type: 'sms', body: body.slice(0, 500),
    });
  }

  return NextResponse.json({ ok: true });
}

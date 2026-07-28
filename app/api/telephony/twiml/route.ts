import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Twilio requests this once the coach's leg (the first call) is answered.
// Bridges the coach to the client's number. Public by design — Twilio can't
// send a session cookie or Bearer token, and there's no sensitive data in
// the response beyond the phone number already known to both call legs.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get('to');

  if (!to) {
    return new NextResponse('<Response><Say>Sorry, this call could not be connected.</Say></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${to}</Dial></Response>`;
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
}

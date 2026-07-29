/**
 * One-click unsubscribe (CAN-SPAM / TCPA). Public route, gated only by the
 * per-borrower unsubscribe_token (see borrowers.unsubscribe_token,
 * lib/messaging/context.ts's unsubscribe_url). No Clerk session required —
 * the client clicking this link from an email/SMS is not logged in.
 *
 * GET so it works as a plain link click; ?channel=sms|email|all controls
 * scope (default: email, since that's the CAN-SPAM-mandated case; SMS
 * STOP-word handling happens at the Twilio layer separately, this covers
 * the web fallback link).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const channel = req.nextUrl.searchParams.get('channel') ?? 'email';
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const sb = createAdminClient();
  const { data: borrower } = await sb.from('borrowers').select('id, org_id').eq('unsubscribe_token', token).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Invalid or expired unsubscribe link' }, { status: 404 });

  const patch: Record<string, boolean> = {};
  if (channel === 'sms' || channel === 'all') patch.sms_opt_out = true;
  if (channel === 'email' || channel === 'all') patch.email_opt_out = true;

  await sb.from('borrowers').update(patch).eq('id', borrower.id);

  return NextResponse.json({ ok: true, message: 'You have been unsubscribed.' });
});

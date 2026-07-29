import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, TWILIO_FROM } from '@/lib/sms';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Thread view for a borrower — opening it marks unread inbound texts read,
// same "viewing marks read" behavior as the portal message thread.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const borrowerId = new URL(req.url).searchParams.get('borrowerId');
  if (!borrowerId) return NextResponse.json({ error: 'borrowerId required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: messages, error } = await sb
    .from('sms_messages')
    .select('id, direction, body, status, created_at')
    .eq('org_id', orgId)
    .eq('borrower_id', borrowerId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('sms_messages').update({ read_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('borrower_id', borrowerId).eq('direction', 'inbound').is('read_at', null);

  return NextResponse.json({ messages: messages ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { borrowerId?: string; body?: string };
  if (!body.borrowerId || !body.body?.trim()) return NextResponse.json({ error: 'borrowerId and body are required' }, { status: 400 });

  const sb = createAdminClient();
  const [{ data: profile }, { data: borrower }] = await Promise.all([
    sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle(),
    sb.from('borrowers').select('id, phone').eq('id', body.borrowerId).eq('org_id', orgId).maybeSingle(),
  ]);
  if (!borrower?.phone) return NextResponse.json({ error: 'This client has no phone number on file.' }, { status: 400 });

  const result = await sendSms(borrower.phone as string, body.body.trim());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const { error } = await sb.from('sms_messages').insert({
    org_id: orgId,
    borrower_id: body.borrowerId,
    direction: 'outbound',
    body: body.body.trim(),
    to_number: borrower.phone,
    from_number: TWILIO_FROM,
    twilio_sid: result.sid,
    status: 'sent',
    sent_by: profile?.id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});

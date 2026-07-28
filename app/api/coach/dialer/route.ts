import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { initiateClickToCall } from '@/lib/dialer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const borrowerId = new URL(req.url).searchParams.get('borrowerId');
  if (!borrowerId) return NextResponse.json({ error: 'borrowerId required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: calls, error } = await sb
    .from('call_logs')
    .select('id, status, to_number, duration_seconds, started_at, ended_at')
    .eq('org_id', orgId)
    .eq('borrower_id', borrowerId)
    .order('started_at', { ascending: false })
    .limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ calls: calls ?? [] });
}

export async function POST(req: Request) {
  const { orgId, userId } = await getOrgContext();
  if (!orgId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { borrowerId?: string };
  if (!body.borrowerId) return NextResponse.json({ error: 'borrowerId required' }, { status: 400 });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set — required so Twilio can reach the TwiML/status webhooks.' }, { status: 500 });

  const sb = createAdminClient();
  const [{ data: coach }, { data: borrower }] = await Promise.all([
    sb.from('profiles').select('id, phone').eq('clerk_user_id', userId).eq('org_id', orgId).maybeSingle(),
    sb.from('borrowers').select('id, phone, first_name, last_name').eq('id', body.borrowerId).eq('org_id', orgId).maybeSingle(),
  ]);

  if (!coach?.phone) return NextResponse.json({ error: 'No phone number on file for your coach profile. Add one in settings.' }, { status: 400 });
  if (!borrower?.phone) return NextResponse.json({ error: 'This client has no phone number on file.' }, { status: 400 });

  const result = await initiateClickToCall({ coachPhone: coach.phone as string, clientPhone: borrower.phone as string, baseUrl });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const { data: logRow, error: logError } = await sb
    .from('call_logs')
    .insert({
      org_id: orgId,
      borrower_id: body.borrowerId,
      coach_id: coach.id,
      twilio_call_sid: result.callSid,
      to_number: borrower.phone,
      from_number: coach.phone,
      status: 'initiated',
    })
    .select('id')
    .single();
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  return NextResponse.json({ ok: true, callSid: result.callSid, logId: logRow.id });
}

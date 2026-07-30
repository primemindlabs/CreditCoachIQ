import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { generateReplyDraft } from '@/lib/ai/replyDraft';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Shared by both the SMS thread and the portal message thread on the client
// detail page — accepts the thread the client already has loaded (same
// pattern as /api/coach/today/briefing) rather than re-querying either
// sms_messages or portal_messages itself.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    channel?: 'sms' | 'portal';
    firstName?: string;
    thread?: { from: 'coach' | 'client'; body: string }[];
  };
  if (body.channel !== 'sms' && body.channel !== 'portal') return NextResponse.json({ error: 'channel must be sms or portal' }, { status: 400 });
  if (!body.thread?.length) return NextResponse.json({ error: 'thread is required' }, { status: 400 });

  const draft = await generateReplyDraft({
    channel: body.channel,
    firstName: body.firstName ?? 'there',
    thread: body.thread,
  });

  if (!draft) return NextResponse.json({ error: 'Could not generate a suggestion right now. Try writing it yourself.' }, { status: 502 });
  return NextResponse.json({ draft });
});

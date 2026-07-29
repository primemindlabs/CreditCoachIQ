import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { draftMessageCopy } from '@/lib/ai/templateDraft';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin' && role !== 'coach') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { purpose?: string; channel?: 'email' | 'sms' };
  if (!body.purpose?.trim() || !body.channel) return NextResponse.json({ error: 'purpose and channel are required' }, { status: 400 });
  if (!['email', 'sms'].includes(body.channel)) return NextResponse.json({ error: 'channel must be email or sms' }, { status: 400 });

  const draft = await draftMessageCopy({ purpose: body.purpose.trim(), channel: body.channel });
  return NextResponse.json(draft);
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { sendQuizInvite } from '@/lib/quiz/sendInvite';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Coach-triggered (or called at enrollment time) send of the pre-call quiz.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { borrowerId?: string };
  if (!body.borrowerId) return NextResponse.json({ error: 'borrowerId required' }, { status: 400 });

  const result = await sendQuizInvite(orgId, body.borrowerId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
});

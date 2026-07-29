import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { generateTodayBriefing } from '@/lib/ai/todayBriefing';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

interface BorrowerRef { first_name: string; last_name: string }

// Takes the same payload the Today page already fetched from
// /api/coach/today — no duplicate queries, this is purely the narrative
// layer on top of data the client already has and the user has already
// seen rendered as raw lists.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    tasks?: unknown[];
    upcomingCalls?: unknown[];
    unreadMessages?: unknown[];
    openComplaints?: { category: string; status: string; borrowers: BorrowerRef | null }[];
    paymentFailures?: { payment_retry_count: number; borrowers: BorrowerRef | null }[];
    scoreJumps?: { name: string; delta: number }[];
  };

  const name = (b: BorrowerRef | null | undefined) => (b ? `${b.first_name} ${b.last_name}` : 'a client');

  const briefing = await generateTodayBriefing({
    openTaskCount: body.tasks?.length ?? 0,
    upcomingCallCount: body.upcomingCalls?.length ?? 0,
    unreadMessageCount: body.unreadMessages?.length ?? 0,
    openComplaints: (body.openComplaints ?? []).map((c) => ({ name: name(c.borrowers), category: c.category, status: c.status })),
    paymentFailures: (body.paymentFailures ?? []).map((p) => ({ name: name(p.borrowers), retryCount: p.payment_retry_count })),
    scoreJumps: body.scoreJumps ?? [],
  });

  return NextResponse.json({ briefing });
});

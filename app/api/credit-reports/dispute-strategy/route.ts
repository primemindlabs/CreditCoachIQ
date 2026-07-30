import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { generateDisputeStrategy } from '@/lib/ai/disputeStrategy';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Mirrors /api/coach/today/briefing's shape — accepts data the client
// already fetched (the tradelines list) rather than re-querying, so this
// stays a thin narrative layer over /api/credit-reports/tradelines.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string;
    tradelines?: { creditor_name: string; bureau: string; dispute_reason: string | null; dispute_priority: number | null; estimated_score_gain: number | null; is_disputable: boolean }[];
  };
  const disputable = (body.tradelines ?? []).filter((t) => t.is_disputable);

  const strategy = await generateDisputeStrategy({
    firstName: body.firstName ?? 'this client',
    tradelines: disputable.map((t) => ({
      creditorName: t.creditor_name,
      bureau: t.bureau,
      disputeReason: t.dispute_reason,
      disputePriority: t.dispute_priority,
      estimatedScoreGain: t.estimated_score_gain,
    })),
  });

  return NextResponse.json({ strategy });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { generateChurnNarrative } from '@/lib/ai/churnNarrative';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Accepts the risk score (from the main GET /api/coach/client/[borrowerId]
// payload) and activity timeline (from .../activity) the client already has
// loaded — same "pass in what's already fetched" convention as
// today/briefing and call-brief, avoids a third re-query of the same data.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string;
    risk?: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] };
    activity?: { type: string; label: string; detail: string | null; createdAt: string }[];
  };
  if (!body.risk) return NextResponse.json({ error: 'risk is required' }, { status: 400 });

  const narrative = await generateChurnNarrative({
    firstName: body.firstName ?? 'this client',
    score: body.risk.score,
    level: body.risk.level,
    reasons: body.risk.reasons ?? [],
    activity: body.activity ?? [],
  });

  return NextResponse.json({ narrative });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { recommendStackSequence } from '@/lib/stacking/recommend';

export const dynamic = 'force-dynamic';

// Rules-of-thumb lender-order suggestion for a client's stack plan.
// See lib/stacking/recommend.ts — not a prediction model, a starting ranking.
export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });

  const recommendations = await recommendStackSequence(orgId, borrowerId);
  return NextResponse.json({
    recommendations,
    disclaimer: 'Rules-of-thumb ranking from a small hand-seeded reference set, not a guarantee of approval. Verify current terms with each lender before advising a client.',
  });
}

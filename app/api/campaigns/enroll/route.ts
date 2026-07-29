import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { enrollBorrowerInCampaign } from '@/lib/messaging/enroll';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Manual enrollment — a coach adding a client into a campaign that isn't
// (or isn't only) automation-triggered.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { campaign_id?: string; borrower_id?: string };
  if (!body.campaign_id || !body.borrower_id) return NextResponse.json({ error: 'campaign_id and borrower_id are required' }, { status: 400 });

  await enrollBorrowerInCampaign(orgId, body.campaign_id, body.borrower_id);
  return NextResponse.json({ ok: true });
});

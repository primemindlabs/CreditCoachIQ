import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeRevenue, computeClientOutcomes, computeTimeInStage, computeHandoffConversion, computeCommissions } from '@/lib/analytics';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET() {
  const { orgId, role } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const sb = createAdminClient();
  const [revenue, outcomes, timeInStage, handoffConversion, commissions] = await Promise.all([
    computeRevenue(),
    computeClientOutcomes(sb, orgId),
    computeTimeInStage(sb, orgId),
    computeHandoffConversion(sb, orgId),
    computeCommissions(sb, orgId),
  ]);

  return NextResponse.json({ revenue, outcomes, timeInStage, handoffConversion, commissions });
});

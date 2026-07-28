import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Aggregate capital-available rollup + promo-APR-expiration alerts for a
// borrower's credit stack — this is the number that matters to the coach
// and, eventually, to the loan-ready checklist.
export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: applications } = await sb
    .from('credit_stack_applications')
    .select('id, lender_name, status, approved_limit, promo_apr_ends_at')
    .eq('org_id', orgId)
    .eq('borrower_id', borrowerId);

  const active = (applications ?? []).filter((a) => a.status === 'active');
  const capitalAvailable = active.reduce((sum, a) => sum + (Number(a.approved_limit) || 0), 0);

  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const expiringWithin30Days = active.filter((a) => a.promo_apr_ends_at && new Date(a.promo_apr_ends_at as string) <= soon);

  return NextResponse.json({
    capitalAvailable,
    activeApplicationCount: active.length,
    expiringWithin30Days,
  });
}

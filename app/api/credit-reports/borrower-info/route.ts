import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// The credit-reports page only has an enrollmentId (from the client
// dropdown, built off /api/overview) — this resolves it to the borrower's
// name/mailing address for dispute-letter generation, without extending the
// shared overview endpoint for a one-page need.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enrollmentId = new URL(req.url).searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('borrower_id')
    .eq('id', enrollmentId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });

  const { data: borrower, error } = await sb
    .from('borrowers')
    .select('id, first_name, last_name, address_line1, address_line2, city, state, postal_code')
    .eq('id', enrollment.borrower_id as string)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });

  return NextResponse.json({ borrower });
});

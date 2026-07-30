import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Surfaces what the AI extraction already flagged at upload time
// (credit_tradelines.is_disputable / dispute_reason / dispute_priority /
// estimated_score_gain, set by lib/creditReport/parse.ts) so a coach can
// actually review the recommendation before generating letters — previously
// this data existed but nothing in the UI ever showed it, so
// /api/disputes/generate could only be fired blind.
export const GET = withErrorHandling(async function GET(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enrollmentId = new URL(req.url).searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('credit_tradelines')
    .select('id, report_upload_id, creditor_name, account_number, account_type, bureau, balance, status, payment_status, negative_remarks, is_disputable, dispute_reason, dispute_priority, estimated_score_gain, dispute_status')
    .eq('enrollment_id', enrollmentId)
    .eq('org_id', orgId)
    .order('dispute_priority', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tradelines: data ?? [] });
});

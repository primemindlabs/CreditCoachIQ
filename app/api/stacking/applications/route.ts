import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

const STATUSES = ['planned', 'applied', 'approved', 'denied', 'active', 'promo_expired', 'closed'];

// Individual card/lender applications under a stack plan.
export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.stack_plan_id || !body.borrower_id || !body.lender_name) {
    return NextResponse.json({ error: 'stack_plan_id, borrower_id, and lender_name are required' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('credit_stack_applications')
    .insert({
      org_id: orgId,
      stack_plan_id: body.stack_plan_id,
      borrower_id: body.borrower_id,
      lender_name: body.lender_name,
      product_name: body.product_name ?? null,
      status: 'planned',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ application: data });
});

// PATCH — record an application outcome (approved/denied/active) and its promo terms.
// This is also where the deferred-interest disclosure requirement lives: any
// PATCH that sets status to 'active' with a promo_apr_months value should be
// paired with client-facing copy stating the promo end date plainly (enforced
// in the UI layer, not the API — but promo_apr_ends_at is required here so
// the alerting in /summary has something to key off).
export const PATCH = withErrorHandling(async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    approved_limit?: number;
    promo_apr_months?: number;
    promo_apr_ends_at?: string;
    standard_apr?: number;
    denial_reason?: string;
    applied_at?: string;
  };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  if (b.status === 'active' && !b.promo_apr_ends_at) {
    return NextResponse.json({ error: 'promo_apr_ends_at is required when marking an application active (deferred-interest disclosure)' }, { status: 400 });
  }

  const sb = createAdminClient();
  const patch: Record<string, unknown> = {};
  for (const k of ['status', 'approved_limit', 'promo_apr_months', 'promo_apr_ends_at', 'standard_apr', 'denial_reason', 'applied_at'] as const) {
    if (b[k] !== undefined) patch[k] = b[k];
  }

  const { error } = await sb.from('credit_stack_applications').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

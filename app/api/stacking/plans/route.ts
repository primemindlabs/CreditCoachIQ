import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';

export const dynamic = 'force-dynamic';

// A coach-built sequence of target lenders/cards for a client's credit stack.
export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  const sb = createAdminClient();
  let query = sb.from('credit_stack_plans').select('*, credit_stack_applications(*)').eq('org_id', orgId);
  if (borrowerId) query = query.eq('borrower_id', borrowerId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plans: data ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.borrower_id || !body.target_capital) {
    return NextResponse.json({ error: 'borrower_id and target_capital are required' }, { status: 400 });
  }

  const { data: borrower } = await sb.from('borrowers').select('plan_tier').eq('id', String(body.borrower_id)).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });
  try {
    assertTierIncludes(borrower.plan_tier as string, 'credit_stacking');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  const { data, error } = await sb
    .from('credit_stack_plans')
    .insert({
      org_id: orgId,
      borrower_id: body.borrower_id,
      business_credit_profile_id: body.business_credit_profile_id ?? null,
      target_capital: body.target_capital,
      planned_sequence: body.planned_sequence ?? [],
      status: 'planning',
      created_by: profile?.id ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plan: data });
}

export async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; planned_sequence?: unknown; target_capital?: number };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (b.status) patch.status = b.status;
  if (b.planned_sequence) patch.planned_sequence = b.planned_sequence;
  if (b.target_capital) patch.target_capital = b.target_capital;
  const { error } = await sb.from('credit_stack_plans').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

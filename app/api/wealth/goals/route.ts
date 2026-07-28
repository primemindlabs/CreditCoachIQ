import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('financial_goals').select('*').eq('org_id', orgId).eq('borrower_id', borrowerId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goals: data ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.borrower_id || !body.title) return NextResponse.json({ error: 'borrower_id and title are required' }, { status: 400 });

  const { data: borrower } = await sb.from('borrowers').select('plan_tier').eq('id', String(body.borrower_id)).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 });
  try {
    assertTierIncludes(borrower.plan_tier as string, 'wealth_coaching');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { data, error } = await sb.from('financial_goals').insert({
    org_id: orgId,
    borrower_id: body.borrower_id,
    title: body.title,
    target_amount: body.target_amount ?? null,
    target_date: body.target_date ?? null,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}

export async function PATCH(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; current_amount?: number; status?: string };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (b.current_amount !== undefined) patch.current_amount = b.current_amount;
  if (b.status) patch.status = b.status;
  const { error } = await sb.from('financial_goals').update(patch).eq('id', b.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

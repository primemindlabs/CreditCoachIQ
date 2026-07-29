import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('budgets').select('*, budget_categories(*)').eq('org_id', orgId).eq('borrower_id', borrowerId).order('month', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budgets: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as {
    borrower_id?: string; month?: string; monthly_income?: number;
    categories?: { category: string; planned_amount: number }[];
  };
  if (!body.borrower_id || !body.month) return NextResponse.json({ error: 'borrower_id and month are required' }, { status: 400 });

  const { data: budget, error } = await sb.from('budgets').upsert({
    org_id: orgId,
    borrower_id: body.borrower_id,
    month: body.month,
    monthly_income: body.monthly_income ?? null,
  }, { onConflict: 'org_id,borrower_id,month' }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.categories?.length) {
    await sb.from('budget_categories').delete().eq('budget_id', budget.id);
    await sb.from('budget_categories').insert(
      body.categories.map((c) => ({ budget_id: budget.id, org_id: orgId, category: c.category, planned_amount: c.planned_amount }))
    );
  }

  return NextResponse.json({ budget });
});

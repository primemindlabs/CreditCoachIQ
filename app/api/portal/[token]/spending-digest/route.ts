import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPlaidConfigured } from '@/lib/plaid';
import { assertTierIncludes, PlanGateError } from '@/lib/plans';
import { generateSpendingDigest } from '@/lib/ai/spendingDigest';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/spending-digest'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });
  if (!isPlaidConfigured()) return NextResponse.json({ configured: false, digest: null });

  const sb = createAdminClient();
  const { data: borrower } = await sb.from('borrowers').select('first_name, plan_tier').eq('id', ctx.borrowerId).eq('org_id', ctx.orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    assertTierIncludes(borrower.plan_tier as string, 'ai_spending_digest');
  } catch (err) {
    if (err instanceof PlanGateError) return NextResponse.json({ configured: true, digest: null, gated: true });
    throw err;
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: transactions }, { data: goals }] = await Promise.all([
    sb.from('plaid_transactions').select('merchant_name, category, amount, posted_at').eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).gte('posted_at', thirtyDaysAgo).order('posted_at', { ascending: false }).limit(50),
    sb.from('financial_goals').select('title, target_amount, current_amount').eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).eq('status', 'active'),
  ]);

  if (!transactions?.length) return NextResponse.json({ configured: true, digest: null });

  const digest = await generateSpendingDigest({
    firstName: (borrower.first_name as string) ?? 'there',
    transactions: transactions.map((t) => ({ merchantName: t.merchant_name as string | null, category: t.category as string | null, amount: Number(t.amount), postedAt: t.posted_at as string })),
    goals: (goals ?? []).map((g) => ({ title: g.title as string, targetAmount: g.target_amount as number | null, currentAmount: Number(g.current_amount ?? 0) })),
  });

  return NextResponse.json({ configured: true, digest });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface Debt { id: string; creditor_name: string; balance: number; apr: number | null; minimum_payment: number | null }

/**
 * Generate an avalanche (highest APR first) or snowball (smallest balance
 * first) payoff projection against a client's tracked debts. Pure math over
 * data the client already owns — explicitly NOT investment advice, this is
 * debt-payoff arithmetic, which keeps it outside RIA-registration territory
 * (see STRATEGY.md §5).
 */
function projectPayoff(debts: Debt[], strategy: 'avalanche' | 'snowball', monthlyBudget: number) {
  const order = [...debts].sort((a, b) => {
    if (strategy === 'avalanche') return (b.apr ?? 0) - (a.apr ?? 0);
    return a.balance - b.balance;
  });

  const balances = new Map(order.map((d) => [d.id, d.balance]));
  const minimums = order.reduce((sum, d) => sum + (d.minimum_payment ?? 0), 0);
  let freeCash = Math.max(monthlyBudget - minimums, 0);

  const timeline: { month: number; payoffs: string[] }[] = [];
  let month = 0;
  const maxMonths = 600; // 50-year safety cap

  while ([...balances.values()].some((b) => b > 0) && month < maxMonths) {
    month += 1;
    const payoffsThisMonth: string[] = [];

    for (const d of order) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0) continue;
      const minPay = Math.min(d.minimum_payment ?? 0, bal);
      const monthlyApr = (d.apr ?? 0) / 100 / 12;
      const interest = bal * monthlyApr;
      balances.set(d.id, Math.max(bal + interest - minPay, 0));
    }

    // Apply free cash to the highest-priority debt still open.
    for (const d of order) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0 || freeCash <= 0) continue;
      const pay = Math.min(freeCash, bal);
      balances.set(d.id, bal - pay);
      freeCash -= pay;
      if ((balances.get(d.id) ?? 0) <= 0.01) payoffsThisMonth.push(d.creditor_name);
    }

    if (payoffsThisMonth.length) timeline.push({ month, payoffs: payoffsThisMonth });
    // Money freed up from a paid-off debt's minimum payment rolls into next month's free cash.
    freeCash += order.filter((d) => (balances.get(d.id) ?? 0) <= 0.01 && payoffsThisMonth.includes(d.creditor_name))
      .reduce((s, d) => s + (d.minimum_payment ?? 0), 0);
  }

  return { totalMonths: month, timeline, projectedPayoffDate: addMonths(new Date(), month) };
}

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { borrower_id?: string; strategy?: 'avalanche' | 'snowball'; monthly_budget?: number };
  if (!body.borrower_id || !body.monthly_budget) {
    return NextResponse.json({ error: 'borrower_id and monthly_budget are required' }, { status: 400 });
  }
  const strategy = body.strategy === 'snowball' ? 'snowball' : 'avalanche';

  const sb = createAdminClient();
  const { data: debts } = await sb.from('client_debts').select('*').eq('org_id', orgId).eq('borrower_id', body.borrower_id);
  if (!debts || debts.length === 0) return NextResponse.json({ error: 'No debts on file for this borrower' }, { status: 400 });

  const projection = projectPayoff(debts as Debt[], strategy, body.monthly_budget);

  const { data: plan, error } = await sb.from('debt_payoff_plans').insert({
    org_id: orgId,
    borrower_id: body.borrower_id,
    strategy,
    monthly_budget: body.monthly_budget,
    projected_payoff_date: projection.projectedPayoffDate,
    projection_snapshot: projection,
  }).select('*').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plan });
}

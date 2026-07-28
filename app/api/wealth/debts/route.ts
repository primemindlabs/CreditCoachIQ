import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });
  const sb = createAdminClient();
  const { data, error } = await sb.from('client_debts').select('*').eq('org_id', orgId).eq('borrower_id', borrowerId).order('balance', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ debts: data ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.borrower_id || !body.creditor_name || body.balance == null) {
    return NextResponse.json({ error: 'borrower_id, creditor_name, and balance are required' }, { status: 400 });
  }
  const { data, error } = await sb.from('client_debts').insert({
    org_id: orgId,
    borrower_id: body.borrower_id,
    creditor_name: body.creditor_name,
    balance: body.balance,
    apr: body.apr ?? null,
    minimum_payment: body.minimum_payment ?? null,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ debt: data });
}

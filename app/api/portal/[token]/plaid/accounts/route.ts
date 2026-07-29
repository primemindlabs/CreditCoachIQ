import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPlaidConfigured } from '@/lib/plaid';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/plaid/accounts'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  if (!isPlaidConfigured()) return NextResponse.json({ configured: false, accounts: [], recentTransactions: [] });

  const sb = createAdminClient();
  const [{ data: accounts }, { data: recentTransactions }] = await Promise.all([
    sb.from('plaid_linked_accounts').select('id, institution_name, status, last_synced_at').eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).order('created_at', { ascending: false }),
    sb.from('plaid_transactions').select('id, amount, merchant_name, category, posted_at').eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId).order('posted_at', { ascending: false }).limit(25),
  ]);

  return NextResponse.json({ configured: true, accounts: accounts ?? [], recentTransactions: recentTransactions ?? [] });
});

// Client-initiated unlink — revokes local visibility immediately; a full
// Plaid /item/remove call can be added here once real linked accounts exist
// to test against (safe to leave as a status flip today, since sync already
// checks status = 'active' before pulling).
export const DELETE = withErrorHandling(async function DELETE(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/plaid/accounts'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  if (!body.accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb.from('plaid_linked_accounts').update({ status: 'revoked' }).eq('id', body.accountId).eq('org_id', ctx.orgId).eq('borrower_id', ctx.borrowerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncTransactions, isPlaidConfigured } from '@/lib/plaid';

export const dynamic = 'force-dynamic';

/**
 * Pulls new transactions for every active Plaid-linked account. Run on a
 * schedule (e.g. every few hours) via the same Bearer CRON_SECRET pattern as
 * app/api/cron/readiness-nudges and app/api/cron/send-queue. No-ops cleanly
 * if Plaid isn't configured, so wiring this into the cron schedule ahead of
 * having real Plaid keys is harmless.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isPlaidConfigured()) return NextResponse.json({ synced: 0, note: 'Plaid not configured' });

  const sb = createAdminClient();
  const { data: accounts } = await sb
    .from('plaid_linked_accounts')
    .select('id, org_id, borrower_id, plaid_access_token_encrypted, sync_cursor')
    .eq('status', 'active');

  let syncedAccounts = 0;
  let transactionsAdded = 0;
  const errors: string[] = [];

  for (const account of accounts ?? []) {
    let cursor: string | null = (account.sync_cursor as string | null) ?? null;
    let hasMore = true;
    let addedForAccount = 0;

    while (hasMore) {
      const result = await syncTransactions(account.plaid_access_token_encrypted as string, cursor);
      if (!result.ok) {
        errors.push(`${account.id}: ${result.error}`);
        break;
      }

      if (result.added.length > 0) {
        await sb.from('plaid_transactions').upsert(
          result.added.map((t) => ({
            org_id: account.org_id,
            borrower_id: account.borrower_id,
            linked_account_id: account.id,
            plaid_transaction_id: t.transaction_id,
            amount: t.amount,
            merchant_name: t.merchant_name ?? t.name,
            category: t.personal_finance_category?.primary ?? null,
            posted_at: t.date,
          })),
          { onConflict: 'plaid_transaction_id' }
        );
        addedForAccount += result.added.length;
      }

      cursor = result.nextCursor;
      hasMore = result.hasMore;
    }

    await sb.from('plaid_linked_accounts').update({ sync_cursor: cursor, last_synced_at: new Date().toISOString() }).eq('id', account.id);
    transactionsAdded += addedForAccount;
    syncedAccounts += 1;
  }

  return NextResponse.json({ syncedAccounts, transactionsAdded, errors });
}

/**
 * Bank-account linking via Plaid, for automated transaction data feeding the
 * wealth-coaching budget module. Follows the same inert-until-configured
 * pattern as lib/disputes/lob.ts: real integration code, gated on
 * PLAID_CLIENT_ID/PLAID_SECRET being set. Unlike Lob (where a mock send is a
 * harmless no-op), a fake Plaid Link token would not actually render in
 * Plaid's client-side widget — so "not configured" surfaces as a clear
 * { configured: false } response rather than a fake success.
 *
 * Deliberately deferred until this pass per the user's own framing: bank
 * linking "adds a real integration + compliance surface (data aggregation
 * consent, security review) that shouldn't block the coaching core." That
 * consent/security surface still applies now that it's built — see
 * governance/VENDOR_RISK_REVIEW.md's Plaid row before enabling live keys.
 */
import 'server-only';
import { encrypt, decrypt } from '@/lib/crypto/encrypt';

const PLAID_ENV = process.env.PLAID_ENV ?? 'sandbox'; // sandbox | development | production
const BASE_URL = `https://${PLAID_ENV === 'production' ? 'production' : PLAID_ENV === 'development' ? 'development' : 'sandbox'}.plaid.com`;

export function isPlaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function credentials() {
  return { client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET };
}

/** Creates a Plaid Link token for the client portal to open Plaid's hosted Link widget. */
export async function createLinkToken(borrowerId: string, borrowerName: string): Promise<{ ok: true; linkToken: string } | { ok: false; error: string }> {
  if (!isPlaidConfigured()) return { ok: false, error: 'Bank linking is not yet enabled. Contact your coach.' };

  try {
    const res = await fetch(`${BASE_URL}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...credentials(),
        user: { client_user_id: borrowerId },
        client_name: 'CreditCoachIQ',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
        webhook: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/plaid` : undefined,
      }),
    });
    const data = (await res.json()) as { link_token?: string; error_message?: string };
    if (!res.ok || !data.link_token) return { ok: false, error: data.error_message ?? `Plaid error ${res.status}` };
    return { ok: true, linkToken: data.link_token };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Plaid request failed' };
  }
}

/** Exchanges the client-side public_token (from Plaid Link's onSuccess) for a durable access_token, encrypted before storage. */
export async function exchangePublicToken(publicToken: string): Promise<{ ok: true; accessTokenEncrypted: string; itemId: string } | { ok: false; error: string }> {
  if (!isPlaidConfigured()) return { ok: false, error: 'Bank linking is not yet enabled.' };

  try {
    const res = await fetch(`${BASE_URL}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials(), public_token: publicToken }),
    });
    const data = (await res.json()) as { access_token?: string; item_id?: string; error_message?: string };
    if (!res.ok || !data.access_token || !data.item_id) return { ok: false, error: data.error_message ?? `Plaid error ${res.status}` };
    return { ok: true, accessTokenEncrypted: encrypt(data.access_token), itemId: data.item_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Plaid request failed' };
  }
}

export interface PlaidTransaction {
  transaction_id: string;
  amount: number;
  merchant_name: string | null;
  name: string;
  personal_finance_category?: { primary?: string };
  date: string;
}

/**
 * Pulls new/updated transactions since the last cursor using Plaid's
 * /transactions/sync endpoint (the current recommended API, supersedes the
 * older /transactions/get + date-range polling pattern).
 */
export async function syncTransactions(accessTokenEncrypted: string, cursor: string | null): Promise<{ ok: true; added: PlaidTransaction[]; nextCursor: string; hasMore: boolean } | { ok: false; error: string }> {
  if (!isPlaidConfigured()) return { ok: false, error: 'Bank linking is not yet enabled.' };

  try {
    const res = await fetch(`${BASE_URL}/transactions/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials(), access_token: decrypt(accessTokenEncrypted), cursor: cursor ?? undefined }),
    });
    const data = (await res.json()) as { added?: PlaidTransaction[]; next_cursor?: string; has_more?: boolean; error_message?: string };
    if (!res.ok) return { ok: false, error: data.error_message ?? `Plaid error ${res.status}` };
    return { ok: true, added: data.added ?? [], nextCursor: data.next_cursor ?? cursor ?? '', hasMore: !!data.has_more };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Plaid request failed' };
  }
}

/** Convenience wrapper used by the cron sync job — fetches institution name once at link time, not on every sync. */
export async function getItemInstitution(accessTokenEncrypted: string): Promise<string | null> {
  if (!isPlaidConfigured()) return null;
  try {
    const res = await fetch(`${BASE_URL}/item/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials(), access_token: decrypt(accessTokenEncrypted) }),
    });
    const data = (await res.json()) as { item?: { institution_id?: string } };
    return data.item?.institution_id ?? null;
  } catch {
    return null;
  }
}

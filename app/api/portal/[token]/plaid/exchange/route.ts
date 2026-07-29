import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangePublicToken, getItemInstitution } from '@/lib/plaid';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Called by the client portal once Plaid Link's onSuccess fires with a
// public_token + basic institution metadata from the widget itself.
export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/plaid/exchange'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { publicToken?: string; institutionName?: string };
  if (!body.publicToken) return NextResponse.json({ error: 'publicToken required' }, { status: 400 });

  const result = await exchangePublicToken(body.publicToken);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const institutionName = body.institutionName ?? (await getItemInstitution(result.accessTokenEncrypted)) ?? 'Linked account';

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('plaid_linked_accounts')
    .insert({
      org_id: ctx.orgId,
      borrower_id: ctx.borrowerId,
      plaid_item_id: result.itemId,
      plaid_access_token_encrypted: result.accessTokenEncrypted,
      institution_name: institutionName,
      status: 'active',
    })
    .select('id, institution_name, status')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, account: data });
});

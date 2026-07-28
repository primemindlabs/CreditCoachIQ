import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLinkToken, isPlaidConfigured } from '@/lib/plaid';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/plaid/link-token'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
  if (!ctx.mfaCurrent) return NextResponse.json({ error: 'Verification required', code: 'mfa_required' }, { status: 401 });

  if (!isPlaidConfigured()) return NextResponse.json({ configured: false });

  const sb = createAdminClient();
  const { data: borrower } = await sb.from('borrowers').select('first_name, last_name').eq('id', ctx.borrowerId).eq('org_id', ctx.orgId).maybeSingle();
  const name = `${borrower?.first_name ?? ''} ${borrower?.last_name ?? ''}`.trim() || 'Client';

  const result = await createLinkToken(ctx.borrowerId, name);
  if (!result.ok) return NextResponse.json({ configured: true, error: result.error }, { status: 400 });

  return NextResponse.json({ configured: true, linkToken: result.linkToken });
}

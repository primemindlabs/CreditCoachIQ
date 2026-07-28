import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { issuePortalToken, revokePortalToken, portalUrl } from '@/lib/portal/token';

export const dynamic = 'force-dynamic';

// Coach control over a client's portal access: view recent access history,
// revoke immediately (suspected compromise, client offboarded), or reissue
// a fresh link (also implicitly revokes the old one — see issuePortalToken).
export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const borrowerId = new URL(req.url).searchParams.get('borrower_id');
  if (!borrowerId) return NextResponse.json({ error: 'borrower_id required' }, { status: 400 });

  const sb = createAdminClient();
  const [{ data: token }, { data: log }] = await Promise.all([
    sb.from('portal_tokens').select('id, expires_at, last_accessed_at, revoked_at, created_at').eq('org_id', orgId).eq('borrower_id', borrowerId).maybeSingle(),
    sb.from('portal_access_log').select('event, path, ip_address, user_agent, created_at').eq('org_id', orgId).eq('borrower_id', borrowerId).order('created_at', { ascending: false }).limit(50),
  ]);

  return NextResponse.json({ token: token ?? null, accessLog: log ?? [] });
}

export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { borrowerId?: string; action?: 'revoke' | 'reissue' };
  if (!body.borrowerId || !body.action) return NextResponse.json({ error: 'borrowerId and action are required' }, { status: 400 });

  if (body.action === 'revoke') {
    await revokePortalToken(orgId, body.borrowerId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reissue') {
    const raw = await issuePortalToken(orgId, body.borrowerId);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.json({ ok: true, portalUrl: portalUrl(base, raw, '') });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

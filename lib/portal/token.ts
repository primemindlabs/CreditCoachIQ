import 'server-only';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Magic-link client-portal auth. The raw token exists only in the one-time
 * link sent to the client — the database stores only its SHA-256 hash, so a
 * database leak (backup export, replica misconfiguration, etc.) does not
 * hand out live portal access. See SECURITY_AUDIT.md.
 */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Issues a fresh token, invalidating any prior one for this borrower (reissue = implicit revoke). */
export async function issuePortalToken(orgId: string, borrowerId: string): Promise<string> {
  const sb = createAdminClient();
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from('portal_tokens')
    .upsert({ org_id: orgId, borrower_id: borrowerId, token_hash: tokenHash, expires_at: expiresAt, revoked_at: null }, { onConflict: 'borrower_id' })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not issue portal token');

  await sb.from('portal_access_log').insert({ org_id: orgId, borrower_id: borrowerId, portal_token_id: data.id, event: 'token_issued' });
  return raw;
}

/** Immediately invalidates a borrower's portal access (coach-triggered, e.g. suspected compromise or offboarding). */
export async function revokePortalToken(orgId: string, borrowerId: string): Promise<void> {
  const sb = createAdminClient();
  const { data } = await sb.from('portal_tokens').select('id').eq('org_id', orgId).eq('borrower_id', borrowerId).maybeSingle();
  if (!data) return;
  await sb.from('portal_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', data.id);
  await sb.from('portal_access_log').insert({ org_id: orgId, borrower_id: borrowerId, portal_token_id: data.id, event: 'token_revoked' });
}

export interface PortalContext {
  orgId: string;
  borrowerId: string;
  portalTokenId: string;
  /** GLBA step-up MFA (email OTP) is current for this session — see lib/portal/otp.ts. */
  mfaCurrent: boolean;
}

export interface VerifyMeta {
  path?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function verifyPortalToken(rawToken: string, meta: VerifyMeta = {}): Promise<PortalContext | null> {
  if (!rawToken) return null;
  const sb = createAdminClient();
  const tokenHash = hashToken(rawToken);
  const { data } = await sb.from('portal_tokens').select('id, org_id, borrower_id, expires_at, revoked_at, mfa_verified_until').eq('token_hash', tokenHash).maybeSingle();

  const logBase = { path: meta.path ?? null, ip_address: meta.ipAddress ?? null, user_agent: meta.userAgent ?? null };

  if (!data) {
    // No org/borrower to scope this failed attempt to — log without them.
    await sb.from('portal_access_log').insert({ ...logBase, event: 'verify_failed' });
    return null;
  }
  if (data.revoked_at) {
    await sb.from('portal_access_log').insert({ ...logBase, org_id: data.org_id, borrower_id: data.borrower_id, portal_token_id: data.id, event: 'verify_revoked' });
    return null;
  }
  if (data.expires_at && new Date(data.expires_at as string) < new Date()) {
    await sb.from('portal_access_log').insert({ ...logBase, org_id: data.org_id, borrower_id: data.borrower_id, portal_token_id: data.id, event: 'verify_expired' });
    return null;
  }

  void sb.from('portal_tokens').update({ last_accessed_at: new Date().toISOString() }).eq('id', data.id).then(() => undefined, () => undefined);
  void sb.from('portal_access_log').insert({ ...logBase, org_id: data.org_id, borrower_id: data.borrower_id, portal_token_id: data.id, event: 'verify_success' }).then(() => undefined, () => undefined);

  const mfaVerifiedUntil = data.mfa_verified_until as string | null;
  const mfaCurrent = !!mfaVerifiedUntil && new Date(mfaVerifiedUntil) > new Date();

  return { orgId: data.org_id as string, borrowerId: data.borrower_id as string, portalTokenId: data.id as string, mfaCurrent };
}

/**
 * Gate for portal API routes: token must be valid AND the step-up MFA
 * challenge must be current. Routes that issue/verify the OTP itself
 * (app/api/portal/[token]/mfa/*) call verifyPortalToken directly instead,
 * since they're what makes mfaCurrent become true in the first place.
 */
export function requireMfaCurrent(ctx: PortalContext): boolean {
  return ctx.mfaCurrent;
}

export function portalUrl(base: string, token: string, path: string): string {
  const trimmedBase = base.replace(/\/$/, '');
  return `${trimmedBase}/portal/${token}${path}`;
}

/** Pull request metadata for audit logging without depending on a specific framework request type beyond fetch's Headers. */
export function requestMeta(req: Request, path: string): VerifyMeta {
  return {
    path,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent'),
  };
}

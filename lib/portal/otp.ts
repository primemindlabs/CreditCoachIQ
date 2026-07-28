import 'server-only';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResend, FROM } from '@/lib/resend';

/**
 * GLBA Safeguards Rule step-up MFA for the client portal (16 CFR 314.4(c)(5)
 * expects MFA for access to customer-information systems). Deliberately a
 * lightweight email-OTP step-up rather than full authenticator enrollment —
 * the portal already has a possession factor (the magic-link token itself);
 * this adds a second factor (access to the email inbox on file) once per
 * ~30-day session rather than on every page load, to keep friction sane for
 * a client-facing product. See governance/WISP.md §4.
 */
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes to enter the code
const MFA_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // step-up valid for 30 days once passed
const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function issueOtpChallenge(
  orgId: string,
  borrowerId: string,
  portalTokenId: string
): Promise<{ ok: boolean; error?: string }> {
  const sb = createAdminClient();
  const { data: borrower } = await sb
    .from('borrowers')
    .select('email, first_name')
    .eq('id', borrowerId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (!borrower?.email) {
    return { ok: false, error: 'No email on file to send a verification code to. Contact your coach.' };
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await sb.from('portal_otp_challenges').insert({
    org_id: orgId,
    borrower_id: borrowerId,
    portal_token_id: portalTokenId,
    code_hash: hashCode(code),
    expires_at: expiresAt,
  });

  try {
    await getResend().emails.send({
      from: FROM,
      to: borrower.email as string,
      subject: 'Your CreditCoachIQ verification code',
      html: `<p>Hi ${(borrower.first_name as string) ?? 'there'},</p><p>Your verification code is:</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email — your portal access is not at risk.</p>`,
    });
  } catch (err) {
    console.error('[portal-mfa] OTP email send failed:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not send a verification email right now. Try again shortly.' };
  }

  return { ok: true };
}

export async function verifyOtpChallenge(
  orgId: string,
  borrowerId: string,
  portalTokenId: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const sb = createAdminClient();
  const { data: challenge } = await sb
    .from('portal_otp_challenges')
    .select('id, code_hash, expires_at, attempts')
    .eq('org_id', orgId)
    .eq('borrower_id', borrowerId)
    .eq('portal_token_id', portalTokenId)
    .is('verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challenge) return { ok: false, error: 'No pending verification code. Request a new one.' };
  if (new Date(challenge.expires_at as string) < new Date()) return { ok: false, error: 'That code expired. Request a new one.' };
  if ((challenge.attempts as number) >= MAX_ATTEMPTS) return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };

  if (hashCode(code) !== challenge.code_hash) {
    await sb.from('portal_otp_challenges').update({ attempts: (challenge.attempts as number) + 1 }).eq('id', challenge.id);
    await sb.from('portal_access_log').insert({ org_id: orgId, borrower_id: borrowerId, portal_token_id: portalTokenId, event: 'mfa_failed' });
    return { ok: false, error: 'Incorrect code.' };
  }

  const mfaVerifiedUntil = new Date(Date.now() + MFA_SESSION_MS).toISOString();
  await sb.from('portal_otp_challenges').update({ verified_at: new Date().toISOString() }).eq('id', challenge.id);
  await sb.from('portal_tokens').update({ mfa_verified_until: mfaVerifiedUntil }).eq('id', portalTokenId);
  await sb.from('portal_access_log').insert({ org_id: orgId, borrower_id: borrowerId, portal_token_id: portalTokenId, event: 'mfa_verified' });

  return { ok: true };
}

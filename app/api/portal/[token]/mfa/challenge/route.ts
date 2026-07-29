import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { issueOtpChallenge } from '@/lib/portal/otp';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Sends (or resends) the email OTP for step-up MFA. The token itself must
// still be valid — this doesn't require mfaCurrent, since this route is what
// makes it become current.
export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/mfa/challenge'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });

  const result = await issueOtpChallenge(ctx.orgId, ctx.borrowerId, ctx.portalTokenId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, message: 'A verification code was sent to your email.' });
});

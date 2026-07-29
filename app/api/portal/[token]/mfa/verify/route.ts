import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { verifyOtpChallenge } from '@/lib/portal/otp';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/mfa/verify'));
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 });

  const result = await verifyOtpChallenge(ctx.orgId, ctx.borrowerId, ctx.portalTokenId, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
});

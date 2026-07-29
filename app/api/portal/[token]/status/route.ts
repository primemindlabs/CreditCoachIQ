import { NextResponse } from 'next/server';
import { verifyPortalToken, requestMeta } from '@/lib/portal/token';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Lightweight check the portal shell polls before rendering any page: is the
// link valid, and is step-up MFA current for this session. Kept separate
// from /overview so the gate check doesn't pull the full dashboard payload.
export const GET = withErrorHandling(async function GET(req: Request, { params }: { params: { token: string } }) {
  const ctx = await verifyPortalToken(params.token, requestMeta(req, '/portal/status'));
  if (!ctx) return NextResponse.json({ valid: false });
  return NextResponse.json({ valid: true, mfaCurrent: ctx.mfaCurrent });
});

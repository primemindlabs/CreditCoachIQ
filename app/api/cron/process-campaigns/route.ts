/**
 * Cron-callable send-queue processor. Bearer CRON_SECRET, matching
 * conduit-next's app/api/cron/* pattern. Call every 5-15 minutes from the
 * scheduler (Vercel Cron / GitHub Actions / etc).
 *
 * Single-tenant-ish deployment: no orgId passed, so processDueEnrollments()
 * sweeps every org's due sends in one pass.
 */
import { NextResponse } from 'next/server';
import { processDueEnrollments } from '@/lib/messaging/enroll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await processDueEnrollments();
  return NextResponse.json(result);
}

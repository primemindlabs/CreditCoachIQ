import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getOrgContext } from '@/lib/auth/orgContext';
import { buildAuthUrl } from '@/lib/googleCalendar';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Kicks off the OAuth flow — redirects the coach's browser to Google's
// consent screen. `state` is a random nonce stored in a short-lived cookie
// so the callback can confirm this redirect actually originated here
// (basic CSRF defense on the OAuth dance); the coach's identity itself
// comes from their own Clerk session on the callback request, not from state.
export const GET = withErrorHandling(async function GET() {
  const { userId } = await getOrgContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const state = crypto.randomBytes(16).toString('hex');
  let authUrl: string;
  try {
    authUrl = buildAuthUrl(state);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Google Calendar is not configured' }, { status: 501 });
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('gcal_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
});

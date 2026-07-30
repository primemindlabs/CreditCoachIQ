import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangeCodeForTokens } from '@/lib/googleCalendar';
import { encrypt } from '@/lib/crypto/encrypt';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withErrorHandling(async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.redirect(new URL('/sign-in', req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = req.headers.get('cookie')?.match(/gcal_oauth_state=([^;]+)/)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL('/settings?calendar=state_mismatch', req.url));
  }

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();
  if (!profile) return NextResponse.redirect(new URL('/settings?calendar=error', req.url));

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token on the FIRST consent (or when
      // prompt=consent forces re-consent, which buildAuthUrl always sets) —
      // if it's still missing here, something upstream changed; surface it
      // rather than silently storing a connection that can't refresh.
      return NextResponse.redirect(new URL('/settings?calendar=no_refresh_token', req.url));
    }

    // Fetch the connected account's email for display purposes only.
    let connectedEmail: string | null = null;
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (infoRes.ok) connectedEmail = ((await infoRes.json()) as { email?: string }).email ?? null;
    } catch {
      // Non-critical — connection still works without a display email.
    }

    await sb.from('coach_calendar_connections').upsert({
      org_id: orgId,
      profile_id: profile.id,
      provider: 'google',
      access_token_encrypted: encrypt(tokens.access_token),
      refresh_token_encrypted: encrypt(tokens.refresh_token),
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected_email: connectedEmail,
    }, { onConflict: 'org_id,profile_id,provider' });

    const res = NextResponse.redirect(new URL('/settings?calendar=connected', req.url));
    res.cookies.delete('gcal_oauth_state');
    return res;
  } catch (err) {
    console.error('[google-calendar] OAuth callback failed:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/settings?calendar=error', req.url));
  }
});

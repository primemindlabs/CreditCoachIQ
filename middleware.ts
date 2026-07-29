import { NextResponse } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { checkRateLimit, clientIp } from '@/lib/rateLimit';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)', // Stripe + credit-vendor webhooks verify their own signatures
  '/api/cron(.*)', // send-queue processor + promo-expiring scan — Bearer CRON_SECRET verified in-handler
  '/api/messaging/unsubscribe(.*)', // one-click unsubscribe — token verified in-handler, no session
  '/api/portal(.*)', // client portal (quiz, overview, messages, booking) — portal_tokens verified in-handler, no Clerk session
  '/portal(.*)', // the client-facing portal pages themselves — same token auth, not a Clerk session
  '/api/integrations(.*)', // cross-company server-to-server integrations (e.g. AshleyIQ funding-status sync) — Bearer secret verified in-handler
  '/api/telephony(.*)', // Twilio TwiML + call-status webhooks — Twilio can't send a session; status callback is signature-verified in-handler
]);

/**
 * Every one of these routes is reachable with no Clerk session — that's by
 * design (magic-link portal, webhooks, cron), but it also means Clerk's own
 * bot/abuse protection never sees this traffic. IP-based rate limits here
 * are the backstop. Ordered most- to least-specific; first match wins.
 * See lib/rateLimit.ts for the "fails open if Upstash isn't configured" note.
 */
const RATE_LIMIT_RULES: { pattern: RegExp; bucket: string; limit: number; windowSeconds: number }[] = [
  // Sends a real email — the cheapest abuse vector (spam a client's inbox, or use as a token-validity oracle).
  { pattern: /^\/api\/portal\/[^/]+\/mfa\/challenge$/, bucket: 'portal-mfa-challenge', limit: 5, windowSeconds: 600 },
  // Per-challenge attempt cap already exists (lib/portal/otp.ts, MAX_ATTEMPTS=5); this is IP-level defense in depth
  // against spraying guesses across many freshly-issued challenges.
  { pattern: /^\/api\/portal\/[^/]+\/mfa\/verify$/, bucket: 'portal-mfa-verify', limit: 20, windowSeconds: 600 },
  // Calls the Anthropic API — cost-abuse surface, not just a data-access one.
  { pattern: /^\/api\/portal\/[^/]+\/chat$/, bucket: 'portal-chat', limit: 15, windowSeconds: 60 },
  // General portal catch-all — coarse scraping/DoS backstop; normal client usage is nowhere near this.
  { pattern: /^\/api\/portal\//, bucket: 'portal-general', limit: 120, windowSeconds: 60 },
  { pattern: /^\/api\/messaging\/unsubscribe/, bucket: 'unsubscribe', limit: 30, windowSeconds: 60 },
  // Defense in depth on top of Clerk's own protections.
  { pattern: /^\/(sign-in|sign-up)/, bucket: 'auth', limit: 30, windowSeconds: 60 },
];

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  const rule = RATE_LIMIT_RULES.find((r) => r.pattern.test(pathname));
  if (rule) {
    const ip = clientIp(req);
    const { allowed } = await checkRateLimit(rule.bucket, ip, rule.limit, rule.windowSeconds);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
    }
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};

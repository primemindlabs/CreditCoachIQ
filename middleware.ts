import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

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

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};

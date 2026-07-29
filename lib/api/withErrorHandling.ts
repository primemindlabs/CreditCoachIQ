import { NextResponse } from 'next/server';

/**
 * Wraps a Route Handler so an uncaught exception (missing env var from
 * createAdminClient(), a null-deref, anything) returns a clean JSON 500
 * instead of Next's default error response.
 *
 * Why this matters here specifically: every page's fetch() calls do
 * `const res = await fetch(...); if (!res.ok) { const d = await
 * res.json().catch(() => ({})); setError(d.error ?? ...) }`. That `.catch`
 * only saves you from a *parse* failure — it still needed a response to
 * parse in the first place. Next's own error response for an unhandled
 * throw in a Route Handler is NOT guaranteed to be JSON (in production it's
 * often a bare 500 with no body, or an HTML error page). When that happens,
 * fetch() itself doesn't throw (the network request succeeded — the server
 * responded, just badly), but code that unconditionally calls `res.json()`
 * before checking `res.ok` — which a few pages still did — throws a
 * SyntaxError parsing non-JSON, and that lands in the same catch block as
 * genuine network failures. Net effect: "NEXT_PUBLIC_SUPABASE_URL is not
 * set" (an actionable, specific, fixable error) shows up to the coach as
 * "Could not reach the server," which sends everyone chasing network/CORS
 * theories instead of the one-line env var that's actually missing.
 *
 * This wrapper closes the loop from the server side: whatever throws,
 * whatever the cause, the client always gets back valid JSON with a real
 * `error` message and a 500 status — never a bare/HTML response to choke on.
 */
// Generic over the handler's actual parameter types (Request, NextRequest, or
// no request at all for a plain `GET()`, plus an optional { params } context)
// so this wraps any Route Handler signature without narrowing it to a
// specific Request subtype — that narrowing is what caused TS2345 on the
// handful of routes that type their first arg as NextRequest.
export function withErrorHandling<T extends (...args: any[]) => Promise<Response>>(handler: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected server error';
      const req = args[0] as Request | undefined;
      const label = req?.url ? new URL(req.url).pathname : 'unknown route';
      // Full stack goes to the Vercel function log (server-side only); the
      // client only ever gets the one-line message. Needed the stack once
      // already to chase down a "base64url" error with no other context —
      // don't make that harder to diagnose next time.
      console.error('[api]', req?.method ?? '', label, '-', message, err instanceof Error ? err.stack : err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }) as T;
}

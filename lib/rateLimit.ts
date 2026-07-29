/**
 * IP-based rate limiting for public (no-session) endpoints — portal token
 * verification, step-up MFA, AI chat, webhooks, sign-in/up. These are the
 * routes middleware.ts exempts from Clerk's `auth.protect()`, which means
 * they're reachable by anyone with the URL, including scripted clients.
 * Token entropy (256-bit portal tokens) makes brute force infeasible, but
 * rate limiting still matters for: OTP-email spam (cheap way to annoy or
 * cost a client), AI chat cost abuse, and general scraping/DoS resistance.
 *
 * Talks to Upstash Redis's REST API directly via `fetch` — no SDK. The
 * `@upstash/ratelimit` + `@upstash/redis` packages pull in a Node-only
 * codepath (`process.version`) that Next.js's build flags as unsupported in
 * the Edge Runtime, which is where `middleware.ts` runs on every request.
 * Since `fetch` is natively available in Edge Runtime, hand-rolling this as
 * plain HTTP calls avoids that risk entirely and drops two dependencies.
 *
 * Implements a fixed-window counter (INCR + EXPIRE NX, atomic via Upstash's
 * /pipeline endpoint) rather than a true sliding window — slightly less
 * precise at window boundaries, but that's a fine tradeoff for abuse
 * prevention here, and it's a much simpler primitive to hand-roll correctly.
 *
 * If UPSTASH_REDIS_REST_URL/TOKEN aren't set, this fails OPEN (allows the
 * request) rather than breaking the app before Upstash is provisioned —
 * matches the codebase's existing "inert until configured" pattern (Plaid,
 * credit-vendor webhook secrets). Set the env vars in production; a free
 * Upstash database covers this easily.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function isConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Check + consume one request against a named bucket for the given
 * identifier (typically IP, or IP+token for tighter per-resource limits).
 * Always returns allowed:true if Upstash isn't configured — see module doc.
 */
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  if (!isConfigured()) {
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }

  const key = `ccq:rl:${bucket}:${identifier}`;
  const resetAt = Date.now() + windowSeconds * 1000;

  try {
    const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      // EXPIRE ... NX only sets the TTL if the key has none yet, so the
      // window resets `windowSeconds` after the FIRST request in it, not on
      // every request.
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(windowSeconds), 'NX'],
      ]),
    });

    if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
    const results = (await res.json()) as { result: number }[];
    const count = results[0]?.result ?? 0;

    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
  } catch (err) {
    // Upstash unreachable/misconfigured — fail open rather than taking the app down.
    console.error('[rateLimit] Upstash error, failing open:', err instanceof Error ? err.message : err);
    return { allowed: true, remaining: limit, resetAt };
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

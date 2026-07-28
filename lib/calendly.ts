import 'server-only';
import crypto from 'crypto';

/**
 * Calendly webhook signature verification. Calendly signs webhook payloads
 * with HMAC-SHA256 in the `Calendly-Webhook-Signature` header, formatted as
 * `t=<timestamp>,v1=<signature>` over `${timestamp}.${rawBody}`.
 * https://developer.calendly.com/api-docs/ZG9jOjM5NjEyOTU5-webhook-signatures
 */
export function verifyCalendlySignature(rawBody: string, header: string | null, signingKey: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Build a prefilled Calendly scheduling URL. Client name/email prefill the
 * booking form; borrower_id + org_id ride along in `utm_content` so the
 * webhook handler can resolve which borrower just booked without guessing
 * off name/email matching.
 */
export function buildSchedulingUrl(baseUrl: string, opts: { name?: string; email?: string; borrowerId: string; orgId: string }): string {
  const url = new URL(baseUrl);
  if (opts.name) url.searchParams.set('name', opts.name);
  if (opts.email) url.searchParams.set('email', opts.email);
  url.searchParams.set('utm_content', `${opts.orgId}:${opts.borrowerId}`);
  return url.toString();
}

export function parseBorrowerFromTracking(utmContent: string | null | undefined): { orgId: string; borrowerId: string } | null {
  if (!utmContent || !utmContent.includes(':')) return null;
  const [orgId, borrowerId] = utmContent.split(':');
  if (!orgId || !borrowerId) return null;
  return { orgId, borrowerId };
}

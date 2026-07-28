/**
 * Credit-vendor webhook. Verifies the per-vendor signing secret, normalizes
 * the payload, matches the enrollment by vendor_borrower_id (never
 * SSN/DOB), logs the alert, and runs the agent-notification pipeline.
 * Inert until a real vendor is configured + sends events.
 *
 * Ported unchanged from conduit-next's app/api/webhooks/credit-alert/route.ts
 * — the match/insert already operated on `credit_monitoring_enrollments` and
 * `credit_alerts`, both of which now carry `borrower_id` instead of `lead_id`.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createHmac, timingSafeEqual } from 'crypto';
import { normalizeCreditAlert } from '@/lib/creditAlerts/normalize';
import { triggerCreditAlertPipeline } from '@/lib/creditAlerts/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET_ENV: Record<string, string> = {
  creditxpert: 'CREDITXPERT_WEBHOOK_SECRET',
  factual_data: 'FACTUAL_DATA_WEBHOOK_SECRET',
  xactus: 'XACTUS_WEBHOOK_SECRET',
  meridianlink: 'MERIDIANLINK_WEBHOOK_SECRET',
};

function verify(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const vendor = (req.headers.get('x-credit-vendor') ?? 'unknown').toLowerCase();
  const body = await req.text();

  const secret = process.env[SECRET_ENV[vendor] ?? ''] ?? '';
  if (secret) {
    if (!verify(body, req.headers.get('x-credit-signature') ?? '', secret)) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return new NextResponse('Bad JSON', { status: 400 }); }

  const normalized = normalizeCreditAlert(vendor, payload);
  if (!normalized) return new NextResponse('Unrecognized payload', { status: 400 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_monitoring_enrollments')
    .select('id, borrower_id, org_id')
    .eq('vendor', vendor)
    .eq('vendor_borrower_id', normalized.vendor_borrower_id)
    .eq('is_active', true)
    .maybeSingle();
  if (!enrollment) return new NextResponse('OK', { status: 200 }); // no match — discard quietly

  const { data: alert } = await sb.from('credit_alerts').insert({
    enrollment_id: enrollment.id, borrower_id: enrollment.borrower_id, org_id: enrollment.org_id,
    alert_type: normalized.alert_type, vendor, raw_payload: payload as object,
    previous_score: normalized.previous_score ?? null, new_score: normalized.new_score ?? null,
    inquiring_lender: normalized.inquiring_lender ?? null,
  }).select('id').single();

  if (alert) await triggerCreditAlertPipeline(alert.id, enrollment.org_id).catch(() => undefined);
  return new NextResponse('OK', { status: 200 });
}

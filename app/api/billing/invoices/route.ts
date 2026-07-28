import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import getStripe from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Coach-facing invoice history — pulled live from Stripe rather than a local
// mirror table, same reasoning as lib/analytics.ts's revenue numbers: Stripe
// is the source of truth and a local copy could drift.
export async function GET(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'view_billing')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const borrowerId = searchParams.get('borrowerId');
  if (!borrowerId) return NextResponse.json({ error: 'borrowerId is required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('stripe_customer_id, subscription_status, last_payment_failed_at, last_payment_failure_reason, payment_retry_count')
    .eq('borrower_id', borrowerId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (!enrollment?.stripe_customer_id) {
    return NextResponse.json({
      configured: false,
      subscriptionStatus: enrollment?.subscription_status ?? null,
      lastPaymentFailedAt: null,
      lastPaymentFailureReason: null,
      paymentRetryCount: 0,
      invoices: [],
    });
  }

  let invoices: { id: string; number: string | null; status: string | null; amountDue: number; amountPaid: number; created: string; hostedInvoiceUrl: string | null }[] = [];
  try {
    const stripe = getStripe();
    const list = await stripe.invoices.list({ customer: enrollment.stripe_customer_id as string, limit: 12 });
    invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      amountDue: inv.amount_due / 100,
      amountPaid: inv.amount_paid / 100,
      created: new Date(inv.created * 1000).toISOString(),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    }));
  } catch {
    // STRIPE_SECRET_KEY not set, or the customer has no invoices yet — fail
    // soft, same "inert until configured" pattern the rest of billing follows.
  }

  return NextResponse.json({
    configured: true,
    subscriptionStatus: enrollment.subscription_status,
    lastPaymentFailedAt: enrollment.last_payment_failed_at,
    lastPaymentFailureReason: enrollment.last_payment_failure_reason,
    paymentRetryCount: enrollment.payment_retry_count,
    invoices,
  });
}

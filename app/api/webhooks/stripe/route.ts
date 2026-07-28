import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import getStripe from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Ported from conduit-next's app/api/webhooks/stripe-credit-repair/route.ts.
// Point CreditCoachIQ's NEW Stripe account webhook at
// https://<your-domain>/api/webhooks/stripe and set STRIPE_WEBHOOK_SECRET
// to the signing secret Stripe gives you for that endpoint.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook secret not set' }, { status: 500 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const sb = createAdminClient();

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const enrollmentId = sub.metadata?.enrollment_id;
    if (enrollmentId) {
      const statusMap: Record<string, string> = {
        active: 'active', past_due: 'past_due', canceled: 'canceled',
        unpaid: 'past_due', trialing: 'trial', paused: 'paused',
      };
      await sb.from('credit_repair_enrollments').update({
        stripe_subscription_id: sub.id,
        subscription_status: statusMap[sub.status] ?? sub.status,
        billing_started_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : new Date().toISOString(),
      }).eq('id', enrollmentId);
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const enrollmentId = session.metadata?.enrollment_id;
    if (enrollmentId && session.subscription) {
      await sb.from('credit_repair_enrollments').update({
        stripe_subscription_id: session.subscription as string,
        subscription_status: 'active',
      }).eq('id', enrollmentId);
    }
  }

  // Billing dunning — subscription_status already reflects Stripe's own
  // 'past_due' state from the subscription.updated handler above; these two
  // events add what a coach-facing recovery flow actually needs: when the
  // failure happened, how many attempts so far, and a one-time nudge task
  // (not one per retry) so a coach follows up instead of a client silently
  // losing service.
  if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (customerId) {
      const { data: enrollment } = await sb
        .from('credit_repair_enrollments')
        .select('id, borrower_id, payment_retry_count')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

      if (enrollment) {
        if (event.type === 'invoice.payment_failed') {
          const wasFirstFailure = (enrollment.payment_retry_count as number ?? 0) === 0;
          await sb.from('credit_repair_enrollments').update({
            last_payment_failed_at: new Date().toISOString(),
            last_payment_failure_reason: 'Stripe reported a failed payment attempt — see the Stripe dashboard for the decline reason.',
            payment_retry_count: (enrollment.payment_retry_count as number ?? 0) + 1,
          }).eq('id', enrollment.id as string);

          if (wasFirstFailure) {
            const { data: borrower } = await sb
              .from('borrowers')
              .select('assigned_agent_id, org_id')
              .eq('id', enrollment.borrower_id as string)
              .maybeSingle();
            if (borrower) {
              await sb.from('coach_tasks').insert({
                org_id: borrower.org_id,
                borrower_id: enrollment.borrower_id,
                assigned_to: (borrower.assigned_agent_id as string) ?? null,
                source: 'system',
                type: 'payment_failed',
                title: 'Payment failed — client billing needs attention',
              });
            }
          }
        } else {
          await sb.from('credit_repair_enrollments').update({
            last_payment_failed_at: null,
            last_payment_failure_reason: null,
            payment_retry_count: 0,
          }).eq('id', enrollment.id as string);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}

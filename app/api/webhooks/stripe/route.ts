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

  return NextResponse.json({ received: true });
}

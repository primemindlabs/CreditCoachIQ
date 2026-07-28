import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import getStripe from '@/lib/stripe';
import type { PlanTier } from '@/lib/plans';

export const dynamic = 'force-dynamic';

const TIER_PRICE_ENV: Record<PlanTier, string> = {
  credit_coaching: 'STRIPE_PRICE_CREDIT_COACHING',
  wealth_coaching: 'STRIPE_PRICE_WEALTH_COACHING',
  investor_path: 'STRIPE_PRICE_INVESTOR_PATH',
};

/**
 * Tier upgrade/downgrade. If the client already has an active Stripe
 * subscription, swaps the subscription item to the new tier's price with
 * proration (Stripe computes the credit/charge automatically). If they
 * don't have one yet, returns a Checkout Session URL instead.
 */
export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { borrowerId?: string; newTier?: PlanTier };
  if (!body.borrowerId || !body.newTier || !TIER_PRICE_ENV[body.newTier]) {
    return NextResponse.json({ error: 'borrowerId and a valid newTier are required' }, { status: 400 });
  }
  const priceId = process.env[TIER_PRICE_ENV[body.newTier]];
  if (!priceId) return NextResponse.json({ error: `${TIER_PRICE_ENV[body.newTier]} is not configured` }, { status: 500 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id, stripe_customer_id, stripe_subscription_id')
    .eq('borrower_id', body.borrowerId).eq('org_id', orgId).maybeSingle();
  if (!enrollment) return NextResponse.json({ error: 'No enrollment found for this borrower' }, { status: 404 });

  const stripe = getStripe();

  if (enrollment.stripe_subscription_id) {
    const sub = await stripe.subscriptions.retrieve(enrollment.stripe_subscription_id as string);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) return NextResponse.json({ error: 'Subscription has no line item to swap' }, { status: 500 });

    await stripe.subscriptions.update(enrollment.stripe_subscription_id as string, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
    });
    await sb.from('borrowers').update({ plan_tier: body.newTier }).eq('id', body.borrowerId).eq('org_id', orgId);
    return NextResponse.json({ ok: true, mode: 'updated_subscription' });
  }

  if (!enrollment.stripe_customer_id) return NextResponse.json({ error: 'No Stripe customer on file for this borrower' }, { status: 400 });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: enrollment.stripe_customer_id as string,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { enrollment_id: enrollment.id as string, borrower_id: body.borrowerId },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/canceled`,
  });

  return NextResponse.json({ ok: true, mode: 'checkout_required', checkoutUrl: session.url });
}

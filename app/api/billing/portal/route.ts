import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import getStripe from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Standard Stripe billing portal — payment method, invoice history, cancel.
export async function POST(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { borrowerId?: string };
  if (!body.borrowerId) return NextResponse.json({ error: 'borrowerId required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: enrollment } = await sb.from('credit_repair_enrollments').select('stripe_customer_id').eq('borrower_id', body.borrowerId).eq('org_id', orgId).maybeSingle();
  if (!enrollment?.stripe_customer_id) return NextResponse.json({ error: 'No Stripe customer on file' }, { status: 404 });

  const session = await getStripe().billingPortal.sessions.create({
    customer: enrollment.stripe_customer_id as string,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
  });

  return NextResponse.json({ url: session.url });
}

/**
 * Cron-callable scan: find credit_stack_applications whose 0% promo APR
 * window closes within 30 days, and fire 'stack_promo_expiring' for each
 * borrower who isn't already in an active reminder campaign. Run daily.
 *
 * This is what makes "stack_promo_expiring" campaigns actually fire —
 * unlike the other trigger events, nothing in the app naturally calls
 * fireTrigger() for a date crossing a threshold, so a scan is required.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fireTrigger } from '@/lib/messaging/triggers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = createAdminClient();
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: expiring } = await sb
    .from('credit_stack_applications')
    .select('id, org_id, borrower_id, promo_apr_ends_at')
    .eq('status', 'active')
    .not('promo_apr_ends_at', 'is', null)
    .lte('promo_apr_ends_at', cutoff)
    .gte('promo_apr_ends_at', new Date().toISOString());

  let fired = 0;
  const seen = new Set<string>(); // avoid firing twice if a borrower has multiple expiring cards in the same pass
  for (const app of expiring ?? []) {
    const key = `${app.org_id}:${app.borrower_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Skip if already actively enrolled in a stack_promo_expiring campaign for this borrower.
    const { data: activeCampaigns } = await sb
      .from('campaigns')
      .select('id')
      .eq('org_id', app.org_id)
      .eq('trigger_type', 'stack_promo_expiring')
      .eq('status', 'active');
    const campaignIds = (activeCampaigns ?? []).map((c) => c.id);
    if (campaignIds.length === 0) continue;

    const { data: existingEnrollment } = await sb
      .from('campaign_enrollments')
      .select('id')
      .eq('org_id', app.org_id)
      .eq('borrower_id', app.borrower_id)
      .eq('status', 'active')
      .in('campaign_id', campaignIds)
      .maybeSingle();
    if (existingEnrollment) continue;

    await fireTrigger(app.org_id, 'stack_promo_expiring', { borrowerId: app.borrower_id });
    fired += 1;
  }

  return NextResponse.json({ scanned: (expiring ?? []).length, fired });
}

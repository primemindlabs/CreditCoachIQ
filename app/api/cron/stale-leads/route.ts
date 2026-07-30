/**
 * Cron-callable scan: find leads (lead_status = 'new', never converted/lost)
 * that have gone 14+ days without a contact touch, and fire 'stale_lead' for
 * each one that isn't already in an active nurture enrollment. Run daily.
 *
 * Same shape as promo-expiring — nothing naturally calls fireTrigger() for a
 * date threshold like "days since last contact," so a scan is required.
 * "Untouched" means last_contacted_at is null (never worked) or older than
 * the cutoff — a lead that's been touched recently, even if still 'new',
 * isn't stale.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fireTrigger } from '@/lib/messaging/triggers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STALE_DAYS = 14;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await sb
    .from('borrowers')
    .select('id, org_id, last_contacted_at, created_at')
    .eq('lead_status', 'new')
    .or(`last_contacted_at.is.null,last_contacted_at.lte.${cutoff}`)
    .lte('created_at', cutoff); // never fire on a lead that isn't even 14 days old yet

  let fired = 0;
  for (const lead of stale ?? []) {
    // Skip if already actively enrolled in a stale_lead campaign for this borrower.
    const { data: activeCampaigns } = await sb
      .from('campaigns')
      .select('id')
      .eq('org_id', lead.org_id)
      .eq('trigger_type', 'stale_lead')
      .eq('status', 'active');
    const campaignIds = (activeCampaigns ?? []).map((c) => c.id);
    if (campaignIds.length === 0) continue;

    const { data: existingEnrollment } = await sb
      .from('campaign_enrollments')
      .select('id')
      .eq('org_id', lead.org_id)
      .eq('borrower_id', lead.id)
      .in('campaign_id', campaignIds)
      .maybeSingle(); // any enrollment (active OR completed) — don't re-nurture someone who already went through it once
    if (existingEnrollment) continue;

    await fireTrigger(lead.org_id, 'stale_lead', { borrowerId: lead.id as string });
    fired += 1;
  }

  return NextResponse.json({ scanned: (stale ?? []).length, fired });
}

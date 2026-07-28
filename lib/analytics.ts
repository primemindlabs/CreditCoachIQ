/**
 * Owner-facing analytics: revenue, client outcomes, average time-in-stage,
 * handoff conversion rate. Revenue comes straight from Stripe (real active
 * subscriptions), not an approximation from tier names — there's no local
 * pricing table to go stale against what's actually configured in Stripe.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import getStripe from '@/lib/stripe';

export interface RevenueSnapshot {
  mrr: number; // monthly-equivalent, cents converted to dollars
  activeSubscriptions: number;
  error?: string;
}

/** Sums active Stripe subscriptions into a monthly-equivalent MRR figure. Best-effort — Stripe not configured just returns zeros with a note. */
export async function computeRevenue(): Promise<RevenueSnapshot> {
  if (!process.env.STRIPE_SECRET_KEY) return { mrr: 0, activeSubscriptions: 0, error: 'Stripe not configured' };

  try {
    const stripe = getStripe();
    let mrrCents = 0;
    let count = 0;
    let startingAfter: string | undefined;

    // Paginate — an org could have more than 100 active subscriptions.
    for (let i = 0; i < 20; i++) {
      const page = await stripe.subscriptions.list({
        status: 'active',
        limit: 100,
        starting_after: startingAfter,
        expand: ['data.items.data.price'],
      });
      for (const sub of page.data) {
        count += 1;
        for (const item of sub.items.data) {
          const price = item.price;
          if (!price?.unit_amount) continue;
          const qty = item.quantity ?? 1;
          const amount = price.unit_amount * qty;
          // Normalize to monthly-equivalent regardless of billing interval.
          const interval = price.recurring?.interval;
          const intervalCount = price.recurring?.interval_count ?? 1;
          if (interval === 'year') mrrCents += amount / (12 * intervalCount);
          else if (interval === 'week') mrrCents += (amount * 52) / (12 * intervalCount);
          else if (interval === 'day') mrrCents += (amount * 365) / (12 * intervalCount);
          else mrrCents += amount / intervalCount; // month, or unknown -> treat as monthly
        }
      }
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1]?.id;
    }

    return { mrr: Math.round(mrrCents) / 100, activeSubscriptions: count };
  } catch (err) {
    return { mrr: 0, activeSubscriptions: 0, error: err instanceof Error ? err.message : 'Stripe request failed' };
  }
}

export interface ClientOutcomes {
  totalClients: number;
  activeClients: number;
  byStage: Record<string, number>;
  avgScoreImprovement: number | null; // current - starting, across enrollments with both values
  mortgageReadyCount: number;
}

export async function computeClientOutcomes(sb: SupabaseClient, orgId: string): Promise<ClientOutcomes> {
  const [{ data: borrowers }, { data: enrollments }] = await Promise.all([
    sb.from('borrowers').select('journey_stage').eq('org_id', orgId),
    sb.from('credit_repair_enrollments').select('starting_score_exp, current_score_exp, mortgage_ready_at, status').eq('org_id', orgId),
  ]);

  const byStage: Record<string, number> = {};
  for (const b of borrowers ?? []) {
    const stage = (b.journey_stage as string) ?? 'unknown';
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }
  const activeClients = (borrowers ?? []).filter((b) => !['exited'].includes(b.journey_stage as string)).length;

  const improvements = (enrollments ?? [])
    .filter((e) => e.starting_score_exp != null && e.current_score_exp != null)
    .map((e) => (e.current_score_exp as number) - (e.starting_score_exp as number));
  const avgScoreImprovement = improvements.length > 0 ? Math.round((improvements.reduce((a, b) => a + b, 0) / improvements.length) * 10) / 10 : null;

  const mortgageReadyCount = (enrollments ?? []).filter((e) => !!e.mortgage_ready_at).length;

  return { totalClients: (borrowers ?? []).length, activeClients, byStage, avgScoreImprovement, mortgageReadyCount };
}

export interface TimeInStageResult {
  avgDaysByStage: Record<string, number>;
  sampleSizeByStage: Record<string, number>;
}

/**
 * Average days spent in each stage, computed from completed transitions only
 * (a stage-entry event followed by a later event for the same borrower) — a
 * borrower still sitting in a stage today doesn't yet have a known duration,
 * so including "time so far" would skew the average toward whatever's most
 * recently active rather than reflecting how long the stage actually takes.
 */
export async function computeTimeInStage(sb: SupabaseClient, orgId: string): Promise<TimeInStageResult> {
  const { data: events } = await sb
    .from('journey_stage_events')
    .select('borrower_id, to_stage, created_at')
    .eq('org_id', orgId)
    .order('borrower_id', { ascending: true })
    .order('created_at', { ascending: true });

  const byBorrower = new Map<string, { to_stage: string; created_at: string }[]>();
  for (const e of events ?? []) {
    const id = e.borrower_id as string;
    if (!byBorrower.has(id)) byBorrower.set(id, []);
    byBorrower.get(id)!.push({ to_stage: e.to_stage as string, created_at: e.created_at as string });
  }

  const durationsByStage = new Map<string, number[]>();
  for (const events of byBorrower.values()) {
    for (let i = 0; i < events.length - 1; i++) {
      const stage = events[i].to_stage;
      const start = new Date(events[i].created_at).getTime();
      const end = new Date(events[i + 1].created_at).getTime();
      const days = (end - start) / (1000 * 60 * 60 * 24);
      if (days < 0) continue;
      if (!durationsByStage.has(stage)) durationsByStage.set(stage, []);
      durationsByStage.get(stage)!.push(days);
    }
  }

  const avgDaysByStage: Record<string, number> = {};
  const sampleSizeByStage: Record<string, number> = {};
  for (const [stage, durations] of durationsByStage) {
    avgDaysByStage[stage] = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
    sampleSizeByStage[stage] = durations.length;
  }

  return { avgDaysByStage, sampleSizeByStage };
}

export interface HandoffConversion {
  handoffsSent: number;
  funded: number;
  declined: number;
  inProgress: number;
  conversionRate: number | null; // funded / handoffsSent
}

export async function computeHandoffConversion(sb: SupabaseClient, orgId: string): Promise<HandoffConversion> {
  const { data: handoffs } = await sb
    .from('handoff_packages')
    .select('borrower_id, status')
    .eq('org_id', orgId)
    .in('status', ['sent', 'acknowledged']);

  const sentIds = (handoffs ?? []).map((h) => h.borrower_id as string);
  if (sentIds.length === 0) return { handoffsSent: 0, funded: 0, declined: 0, inProgress: 0, conversionRate: null };

  const { data: borrowers } = await sb.from('borrowers').select('id, funding_status').in('id', sentIds);

  let funded = 0;
  let declined = 0;
  let inProgress = 0;
  for (const b of borrowers ?? []) {
    const status = b.funding_status as string | null;
    if (status === 'funded') funded += 1;
    else if (status === 'declined' || status === 'withdrawn') declined += 1;
    else if (status) inProgress += 1;
  }

  return { handoffsSent: sentIds.length, funded, declined, inProgress, conversionRate: Math.round((funded / sentIds.length) * 1000) / 10 };
}

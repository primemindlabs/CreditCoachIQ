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

export interface CommissionSnapshot {
  paidThisMonth: number;
  pendingPayout: number;
  ytdEarnings: number;
  byPartner: { referralPartnerId: string; partnerName: string; paid: number; pending: number }[];
}

/**
 * Referral-partner commission rollup, read from referral_commission_events
 * (append-only audit table — INSERT-only RLS, see migration 0012). Folded
 * into the existing Analytics page rather than a standalone Commissions
 * module, per direction — this is a KPI surface, not a payout workflow.
 */
export async function computeCommissions(sb: SupabaseClient, orgId: string): Promise<CommissionSnapshot> {
  const { data: events } = await sb
    .from('referral_commission_events')
    .select('referral_partner_id, event_type, amount, created_at')
    .eq('org_id', orgId);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  let paidThisMonth = 0;
  let ytdEarnings = 0;
  const owedByPartner = new Map<string, number>();
  const paidByPartner = new Map<string, number>();

  for (const e of events ?? []) {
    const amount = Number(e.amount) || 0;
    const createdAt = new Date(e.created_at as string);
    const partnerId = e.referral_partner_id as string;

    if (e.event_type === 'commission_paid') {
      paidByPartner.set(partnerId, (paidByPartner.get(partnerId) ?? 0) + amount);
      if (createdAt >= monthStart) paidThisMonth += amount;
      if (createdAt >= yearStart) ytdEarnings += amount;
    } else if (e.event_type === 'commission_owed') {
      owedByPartner.set(partnerId, (owedByPartner.get(partnerId) ?? 0) + amount);
    } else if (e.event_type === 'commission_reversed') {
      owedByPartner.set(partnerId, (owedByPartner.get(partnerId) ?? 0) - amount);
    }
  }

  const partnerIds = Array.from(new Set([...owedByPartner.keys(), ...paidByPartner.keys()]));
  let names = new Map<string, string>();
  if (partnerIds.length > 0) {
    const { data: partners } = await sb.from('referral_partners').select('id, name').in('id', partnerIds);
    names = new Map((partners ?? []).map((p) => [p.id as string, p.name as string]));
  }

  let pendingPayout = 0;
  const byPartner = partnerIds.map((id) => {
    const owed = owedByPartner.get(id) ?? 0;
    const paid = paidByPartner.get(id) ?? 0;
    const pending = Math.max(0, owed - paid);
    pendingPayout += pending;
    return { referralPartnerId: id, partnerName: names.get(id) ?? 'Unknown partner', paid, pending };
  }).sort((a, b) => b.paid + b.pending - (a.paid + a.pending));

  return {
    paidThisMonth: Math.round(paidThisMonth * 100) / 100,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
    ytdEarnings: Math.round(ytdEarnings * 100) / 100,
    byPartner,
  };
}

export interface ProductionGoal {
  id: string;
  profileId: string | null;
  profileName: string | null;
  metric: 'clients_funded' | 'new_enrollments';
  period: 'monthly' | 'quarterly' | 'annual';
  periodStart: string;
  targetValue: number;
  actual: number;
}

function periodEnd(periodStart: Date, period: 'monthly' | 'quarterly' | 'annual'): Date {
  const end = new Date(periodStart);
  if (period === 'monthly') end.setMonth(end.getMonth() + 1);
  else if (period === 'quarterly') end.setMonth(end.getMonth() + 3);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

/**
 * Coach/org production goals (migration 0019) — distinct from financial_goals,
 * which are per-client targets. Computes actual progress against each goal's
 * own period window, scoped to the goal's profile_id when set (org-wide when
 * null), reading whatever's already tracked (funding_status_updated_at,
 * enrollment created_at) rather than a separate ledger.
 */
export async function computeProductionGoals(sb: SupabaseClient, orgId: string): Promise<ProductionGoal[]> {
  const { data: goals } = await sb
    .from('production_goals')
    .select('id, profile_id, metric, period, period_start, target_value')
    .eq('org_id', orgId)
    .order('period_start', { ascending: false });
  if (!goals?.length) return [];

  const profileIds = Array.from(new Set(goals.map((g) => g.profile_id).filter(Boolean))) as string[];
  let names = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await sb.from('profiles').select('id, first_name, last_name').in('id', profileIds);
    names = new Map((profiles ?? []).map((p) => [p.id as string, `${p.first_name} ${p.last_name}`]));
  }

  const results: ProductionGoal[] = [];
  for (const g of goals) {
    const start = new Date(g.period_start as string);
    const end = periodEnd(start, g.period as 'monthly' | 'quarterly' | 'annual');
    let actual = 0;

    if (g.metric === 'clients_funded') {
      let query = sb.from('borrowers').select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('funding_status', 'funded')
        .gte('funding_status_updated_at', start.toISOString()).lt('funding_status_updated_at', end.toISOString());
      if (g.profile_id) query = query.eq('assigned_agent_id', g.profile_id);
      const { count } = await query;
      actual = count ?? 0;
    } else {
      // new_enrollments scoped to a coach requires resolving their borrower
      // ids first — filtering an embedded relation's column via count-only
      // head requests isn't reliable across supabase-js versions, so this
      // mirrors the myBorrowerIds pattern already used in /api/coach/today.
      const { data: enrollments } = await sb.from('credit_repair_enrollments').select('id, borrower_id')
        .eq('org_id', orgId).gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
      if (g.profile_id) {
        const { data: mine } = await sb.from('borrowers').select('id').eq('org_id', orgId).eq('assigned_agent_id', g.profile_id);
        const mineIds = new Set((mine ?? []).map((b) => b.id as string));
        actual = (enrollments ?? []).filter((e) => mineIds.has(e.borrower_id as string)).length;
      } else {
        actual = (enrollments ?? []).length;
      }
    }

    results.push({
      id: g.id as string,
      profileId: (g.profile_id as string) ?? null,
      profileName: g.profile_id ? (names.get(g.profile_id as string) ?? 'Unknown coach') : null,
      metric: g.metric as 'clients_funded' | 'new_enrollments',
      period: g.period as 'monthly' | 'quarterly' | 'annual',
      periodStart: g.period_start as string,
      targetValue: Number(g.target_value),
      actual,
    });
  }
  return results;
}

export interface MonthlyTrends {
  months: string[]; // 'YYYY-MM', oldest first, 6 months
  newEnrollments: number[];
  clientsFunded: number[];
  commissionsPaid: number[];
}

function last6MonthStarts(): Date[] {
  const now = new Date();
  const starts: Date[] = [];
  for (let i = 5; i >= 0; i--) starts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  return starts;
}

function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Last 6 months of the three series that already have real, populated
 * timestamp columns to bucket by (enrollment creation, funding outcome, paid
 * commission events). Deliberately doesn't chart average score over time:
 * credit_repair_enrollments.score_history exists in the schema but nothing
 * in the app writes to it yet, so there's no real data to plot there without
 * inventing it. Charting only what's genuinely tracked.
 */
export async function computeMonthlyTrends(sb: SupabaseClient, orgId: string): Promise<MonthlyTrends> {
  const starts = last6MonthStarts();
  const rangeStart = starts[0];

  const [{ data: enrollments }, { data: funded }, { data: commissionEvents }] = await Promise.all([
    sb.from('credit_repair_enrollments').select('created_at').eq('org_id', orgId).gte('created_at', rangeStart.toISOString()),
    sb.from('borrowers').select('funding_status_updated_at').eq('org_id', orgId).eq('funding_status', 'funded').gte('funding_status_updated_at', rangeStart.toISOString()),
    sb.from('referral_commission_events').select('created_at, amount, event_type').eq('org_id', orgId).eq('event_type', 'commission_paid').gte('created_at', rangeStart.toISOString()),
  ]);

  const months = starts.map(monthLabel);
  const bucket = (dates: string[]): number[] => {
    const counts = new Map(months.map((m) => [m, 0]));
    for (const d of dates) {
      const key = monthLabel(new Date(d));
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return months.map((m) => counts.get(m) ?? 0);
  };

  const newEnrollments = bucket((enrollments ?? []).map((e) => e.created_at as string));
  const clientsFunded = bucket((funded ?? []).map((b) => b.funding_status_updated_at as string).filter(Boolean));

  const commissionSums = new Map(months.map((m) => [m, 0]));
  for (const e of commissionEvents ?? []) {
    const key = monthLabel(new Date(e.created_at as string));
    if (commissionSums.has(key)) commissionSums.set(key, (commissionSums.get(key) ?? 0) + (Number(e.amount) || 0));
  }
  const commissionsPaid = months.map((m) => Math.round((commissionSums.get(m) ?? 0) * 100) / 100);

  return { months, newEnrollments, clientsFunded, commissionsPaid };
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

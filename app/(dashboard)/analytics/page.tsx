'use client';

import { useEffect, useState, useCallback } from 'react';
import { HandCoins, Target, History } from 'lucide-react';
import BarChart from '@/components/ui/BarChart';
import Funnel from '@/components/ui/Funnel';
import ProgressBar from '@/components/ui/ProgressBar';
import { SkeletonCards } from '@/components/ui/Skeleton';
import Eyebrow from '@/components/ui/Eyebrow';
import EmptyState from '@/components/ui/EmptyState';

interface AnalyticsData {
  revenue: { mrr: number; activeSubscriptions: number; error?: string };
  outcomes: { totalClients: number; activeClients: number; byStage: Record<string, number>; avgScoreImprovement: number | null; mortgageReadyCount: number };
  timeInStage: { avgDaysByStage: Record<string, number>; sampleSizeByStage: Record<string, number> };
  handoffConversion: { handoffsSent: number; funded: number; declined: number; inProgress: number; conversionRate: number | null };
  commissions: {
    paidThisMonth: number; pendingPayout: number; ytdEarnings: number;
    byPartner: { referralPartnerId: string; partnerName: string; paid: number; pending: number }[];
  };
  trends: { months: string[]; newEnrollments: number[]; clientsFunded: number[]; commissionsPaid: number[] };
}

const STAGE_LABELS: Record<string, string> = {
  credit_coaching: 'Credit coaching',
  credit_stacking: 'Credit stacking',
  loan_ready: 'Loan ready',
  handed_off: 'Handed off',
  paused: 'Paused',
  exited: 'Exited',
};

const PIPELINE_ORDER = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off'];

interface ProductionGoal {
  id: string; profileId: string | null; profileName: string | null;
  metric: 'clients_funded' | 'new_enrollments'; period: 'monthly' | 'quarterly' | 'annual';
  periodStart: string; targetValue: number; actual: number;
}
interface Agent { id: string; first_name: string; last_name: string; role: string }

const METRIC_LABEL: Record<string, string> = { clients_funded: 'Clients funded', new_enrollments: 'New enrollments' };

function currency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-6">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-[28px] font-medium text-ink">{value}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [goals, setGoals] = useState<ProductionGoal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [roster, setRoster] = useState<Agent[]>([]);
  const [goalForm, setGoalForm] = useState({ profileId: '', metric: 'clients_funded', period: 'monthly', periodStart: firstOfMonth(), targetValue: '' });
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    setGoalsLoading(true);
    const res = await fetch('/api/goals/production');
    if (res.ok) {
      const d = await res.json();
      setGoals(d.goals ?? []);
    }
    setGoalsLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/analytics')
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? `Could not load analytics (${res.status}).`);
          setLoading(false);
          return;
        }
        const d = await res.json();
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not reach the server. Check your connection and try again.');
        setLoading(false);
      });
    loadGoals();
    fetch('/api/coach/roster').then((r) => (r.ok ? r.json() : { agents: [] })).then((d) => setRoster(d.agents ?? []));
  }, [loadGoals]);

  async function addGoal() {
    if (!goalForm.targetValue || Number(goalForm.targetValue) <= 0) return;
    setGoalSaving(true);
    setGoalError(null);
    try {
      const res = await fetch('/api/goals/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: goalForm.profileId || null,
          metric: goalForm.metric,
          period: goalForm.period,
          periodStart: goalForm.periodStart,
          targetValue: Number(goalForm.targetValue),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setGoalError(d.error ?? `Could not save that goal (${res.status}).`);
        return;
      }
      setGoalForm({ profileId: '', metric: 'clients_funded', period: 'monthly', periodStart: firstOfMonth(), targetValue: '' });
      loadGoals();
    } catch {
      setGoalError('Could not reach the server.');
    } finally {
      setGoalSaving(false);
    }
  }

  async function removeGoal(id: string) {
    await fetch(`/api/goals/production?id=${id}`, { method: 'DELETE' });
    loadGoals();
  }

  if (loading) {
    return (
      <div>
        <Eyebrow label="Performance" />
        <h1 className="mb-8 mt-2 text-[40px] font-medium leading-[1.05] tracking-tight text-ink">Analytics</h1>
        <div className="mb-4"><SkeletonCards count={3} /></div>
        <div className="mb-8"><SkeletonCards count={3} /></div>
      </div>
    );
  }
  if (error) return <p className="text-sm text-terra">{error}</p>;
  if (!data) return null;

  return (
    <div>
      <div className="mb-8 border-b border-line pb-8">
        <Eyebrow label="Performance" />
        <h1 className="mt-2 text-[40px] font-medium leading-[1.05] tracking-tight text-ink">
          <span className="italic text-money">Analytics</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">Commissions, pipeline health, and production goals — pulled live from the caseload.</p>
      </div>

      {/* Commissions — leads the page now, ahead of revenue and outcomes. */}
      <Eyebrow n={1} label="Commissions" />
      <div className="mb-4 mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card label="Commissions paid this month" value={currency(data.commissions.paidThisMonth)} />
        <Card label="Pending payout" value={currency(data.commissions.pendingPayout)} />
        <Card label="YTD commission earnings" value={currency(data.commissions.ytdEarnings)} />
      </div>

      <Eyebrow n={2} label="Trends" accent="iris" />
      <div className="mb-8 mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-white p-6">
          <p className="mb-1 text-sm font-medium text-ink">New enrollments</p>
          <p className="mb-3 text-xs text-muted">Last 6 months</p>
          <BarChart labels={data.trends.months} values={data.trends.newEnrollments} color="#6C5CE7" />
        </div>
        <div className="rounded-card border border-line bg-white p-6">
          <p className="mb-1 text-sm font-medium text-ink">Clients funded</p>
          <p className="mb-3 text-xs text-muted">Last 6 months</p>
          <BarChart labels={data.trends.months} values={data.trends.clientsFunded} color="#0F9D58" />
        </div>
        <div className="rounded-card border border-line bg-white p-6">
          <p className="mb-1 text-sm font-medium text-ink">Commissions paid</p>
          <p className="mb-3 text-xs text-muted">Last 6 months</p>
          <BarChart labels={data.trends.months} values={data.trends.commissionsPaid} color="#C9A05C" formatValue={(v) => currency(v)} />
        </div>
      </div>

      <div className="mb-8 rounded-card border border-line bg-white p-6">
        <p className="mb-4 text-sm font-medium text-ink">Commissions by referral partner</p>
        {data.commissions.byPartner.length === 0 ? (
          <EmptyState icon={<HandCoins size={17} strokeWidth={1.75} />} title="No commission activity yet" sub="Paid and pending amounts will appear here once a referral partner is credited." compact />
        ) : (
          <div className="space-y-2">
            {data.commissions.byPartner.map((p) => (
              <div key={p.referralPartnerId} className="flex items-center justify-between border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                <span className="text-ink">{p.partnerName}</span>
                <span className="text-muted">{currency(p.paid)} paid{p.pending > 0 ? `, ${currency(p.pending)} pending` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Eyebrow n={3} label="Revenue & Outcomes" accent="gold" />
      <div className="mb-4 mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card label="Monthly recurring revenue" value={currency(data.revenue.mrr)} sub={data.revenue.error ?? `${data.revenue.activeSubscriptions} active subscriptions`} />
        <Card label="Active clients" value={String(data.outcomes.activeClients)} sub={`${data.outcomes.totalClients} total`} />
        <Card label="Handoff conversion rate" value={data.handoffConversion.conversionRate != null ? `${data.handoffConversion.conversionRate}%` : 'n/a'} sub={`${data.handoffConversion.funded} funded of ${data.handoffConversion.handoffsSent} handed off`} />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card label="Avg. score improvement" value={data.outcomes.avgScoreImprovement != null ? `+${data.outcomes.avgScoreImprovement}` : 'n/a'} sub="Experian, current vs. starting" />
        <Card label="Mortgage-ready clients" value={String(data.outcomes.mortgageReadyCount)} />
        <Card label="Handoffs in progress" value={String(data.handoffConversion.inProgress)} sub={`${data.handoffConversion.declined} declined/withdrawn`} />
      </div>

      <Eyebrow n={4} label="Pipeline" />
      <div className="mb-8 mt-3 rounded-card border border-line bg-white p-6">
        <p className="mb-1 text-sm font-medium text-ink">Pipeline funnel</p>
        <p className="mb-4 text-xs text-muted">Clients currently at each stage, forward progression only. Paused and exited clients aren&apos;t part of the funnel flow.</p>
        <Funnel
          stages={PIPELINE_ORDER.map((stage) => ({ label: STAGE_LABELS[stage], count: data.outcomes.byStage[stage] ?? 0 }))}
        />
        {((data.outcomes.byStage.paused ?? 0) > 0 || (data.outcomes.byStage.exited ?? 0) > 0) && (
          <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
            {data.outcomes.byStage.paused ?? 0} paused, {data.outcomes.byStage.exited ?? 0} exited.
          </p>
        )}
      </div>

      <div className="mb-8 rounded-card border border-line bg-white p-6">
        <p className="mb-1 text-sm font-medium text-ink">Average time in stage</p>
        <p className="mb-4 text-sm text-muted">Based on completed transitions only. Clients still in a stage today aren&apos;t counted until they move.</p>
        {Object.keys(data.timeInStage.avgDaysByStage).length === 0 ? (
          <EmptyState icon={<History size={17} strokeWidth={1.75} />} title="Not enough history yet" sub="This fills in once clients complete stage transitions." compact accent="iris" />
        ) : (
          <div className="space-y-2">
            {Object.entries(data.timeInStage.avgDaysByStage).map(([stage, days]) => (
              <div key={stage} className="flex justify-between text-sm">
                <span className="text-ink">{STAGE_LABELS[stage] ?? stage}</span>
                <span className="text-muted">{days} days avg. (n={data.timeInStage.sampleSizeByStage[stage]})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Production goals — coach/org-level targets, distinct from per-client
          financial_goals. Admin-managed here since goal-setting is a
          leadership/analytics action, not a caseload action. */}
      <Eyebrow n={5} label="Production Goals" accent="gold" />
      <div className="mb-8 mt-3 rounded-card border border-line bg-white p-6">
        <p className="mb-4 text-sm font-medium text-ink">Production goals</p>
        {goalsLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : goals.length === 0 ? (
          <EmptyState icon={<Target size={17} strokeWidth={1.75} />} title="No goals set yet" sub="Set a monthly, quarterly, or annual target below to start tracking." compact accent="gold" />
        ) : (
          <div className="mb-5 space-y-4">
            {goals.map((g) => (
              <div key={g.id}>
                <ProgressBar
                  value={g.actual}
                  target={g.targetValue}
                  accent="iris"
                  label={`${METRIC_LABEL[g.metric]} · ${g.profileName ?? 'Org-wide'} · ${g.period} (from ${g.periodStart})`}
                  sub={`${g.actual} / ${g.targetValue}`}
                />
                <button onClick={() => removeGoal(g.id)} className="mt-1 text-xs text-muted hover:text-terra">Delete goal</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-5">
          <select value={goalForm.profileId} onChange={(e) => setGoalForm({ ...goalForm, profileId: e.target.value })} className="rounded-control border border-line px-2.5 py-2 text-sm">
            <option value="">Org-wide</option>
            {roster.map((a) => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
          </select>
          <select value={goalForm.metric} onChange={(e) => setGoalForm({ ...goalForm, metric: e.target.value })} className="rounded-control border border-line px-2.5 py-2 text-sm">
            <option value="clients_funded">Clients funded</option>
            <option value="new_enrollments">New enrollments</option>
          </select>
          <select value={goalForm.period} onChange={(e) => setGoalForm({ ...goalForm, period: e.target.value })} className="rounded-control border border-line px-2.5 py-2 text-sm">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
          <input type="date" value={goalForm.periodStart} onChange={(e) => setGoalForm({ ...goalForm, periodStart: e.target.value })} className="figure rounded-control border border-line px-2.5 py-2 text-sm" />
          <input type="number" value={goalForm.targetValue} onChange={(e) => setGoalForm({ ...goalForm, targetValue: e.target.value })} placeholder="Target" className="rounded-control border border-line px-2.5 py-2 text-sm" />
        </div>
        {goalError && <p className="mt-2 text-xs text-terra">{goalError}</p>}
        <button onClick={addGoal} disabled={goalSaving || !goalForm.targetValue} className="mt-3 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
          {goalSaving ? 'Saving…' : 'Add goal'}
        </button>
      </div>

    </div>
  );
}

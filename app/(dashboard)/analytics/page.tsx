'use client';

import { useEffect, useState } from 'react';

interface AnalyticsData {
  revenue: { mrr: number; activeSubscriptions: number; error?: string };
  outcomes: { totalClients: number; activeClients: number; byStage: Record<string, number>; avgScoreImprovement: number | null; mortgageReadyCount: number };
  timeInStage: { avgDaysByStage: Record<string, number>; sampleSizeByStage: Record<string, number> };
  handoffConversion: { handoffsSent: number; funded: number; declined: number; inProgress: number; conversionRate: number | null };
}

const STAGE_LABELS: Record<string, string> = {
  credit_coaching: 'Credit coaching',
  credit_stacking: 'Credit stacking',
  loan_ready: 'Loan ready',
  handed_off: 'Handed off',
  paused: 'Paused',
  exited: 'Exited',
};

function currency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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

  useEffect(() => {
    fetch('/api/analytics').then(async (res) => {
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? 'Could not load analytics'); setLoading(false); return; }
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <p className="text-sm text-terra">{error}</p>;
  if (!data) return null;

  return (
    <div>
      <h1 className="mb-8 text-[26px] font-medium text-ink">Analytics</h1>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card label="Monthly recurring revenue" value={currency(data.revenue.mrr)} sub={data.revenue.error ?? `${data.revenue.activeSubscriptions} active subscriptions`} />
        <Card label="Active clients" value={String(data.outcomes.activeClients)} sub={`${data.outcomes.totalClients} total`} />
        <Card label="Handoff conversion rate" value={data.handoffConversion.conversionRate != null ? `${data.handoffConversion.conversionRate}%` : '—'} sub={`${data.handoffConversion.funded} funded of ${data.handoffConversion.handoffsSent} handed off`} />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card label="Avg. score improvement" value={data.outcomes.avgScoreImprovement != null ? `+${data.outcomes.avgScoreImprovement}` : '—'} sub="Experian, current vs. starting" />
        <Card label="Mortgage-ready clients" value={String(data.outcomes.mortgageReadyCount)} />
        <Card label="Handoffs in progress" value={String(data.handoffConversion.inProgress)} sub={`${data.handoffConversion.declined} declined/withdrawn`} />
      </div>

      <div className="mb-8 rounded-card border border-line bg-white p-6">
        <p className="mb-4 text-sm font-medium text-ink">Clients by stage</p>
        <div className="space-y-3">
          {Object.entries(data.outcomes.byStage).map(([stage, count]) => {
            const pct = data.outcomes.totalClients > 0 ? Math.round((count / data.outcomes.totalClients) * 100) : 0;
            return (
              <div key={stage}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-ink">{STAGE_LABELS[stage] ?? stage}</span>
                  <span className="text-muted">{count} ({pct}%)</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-money" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-card border border-line bg-white p-6">
        <p className="mb-1 text-sm font-medium text-ink">Average time in stage</p>
        <p className="mb-4 text-sm text-muted">Based on completed transitions only — clients still in a stage today aren&apos;t counted until they move.</p>
        {Object.keys(data.timeInStage.avgDaysByStage).length === 0 ? (
          <p className="text-sm text-muted">Not enough stage-transition history yet.</p>
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
    </div>
  );
}

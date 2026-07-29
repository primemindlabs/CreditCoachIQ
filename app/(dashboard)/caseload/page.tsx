'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Users, TrendingUp, Clock, AlertTriangle } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';

interface Client {
  id: string;
  first_name: string;
  last_name: string;
  plan_tier: string;
  journey_stage: string;
  journey_stage_updated_at: string;
  daysInStage: number;
  risk: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] };
}

const RISK_STYLE: Record<string, string> = {
  high: 'bg-terra-tint text-terra',
  medium: 'bg-gold-tint text-ink',
  low: 'bg-line text-muted',
};

const STAGE_LABELS: Record<string, string> = {
  credit_coaching: 'Credit coaching',
  credit_stacking: 'Credit stacking',
  loan_ready: 'Loan ready',
  handed_off: 'Handed off',
  paused: 'Paused',
  exited: 'Exited',
};

const STAGE_STYLE: Record<string, string> = {
  credit_coaching: 'bg-line text-muted',
  credit_stacking: 'bg-money-tint text-money-hover',
  loan_ready: 'bg-money-tint text-money-hover',
  handed_off: 'bg-money text-white',
  paused: 'bg-terra-tint text-terra',
  exited: 'bg-line text-muted',
};

function initials(first: string, last: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

export default function CaseloadPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/coach/caseload${showAll ? '?all=true' : ''}`)
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []))
      .finally(() => setLoading(false));
  }, [showAll]);

  // All stats below are derived client-side from the same real caseload
  // response already fetched — nothing here is fabricated or estimated.
  const stats = useMemo(() => {
    const total = clients.length;
    const advancing = clients.filter((c) => c.journey_stage === 'credit_stacking' || c.journey_stage === 'loan_ready').length;
    const avgDays = total > 0 ? Math.round(clients.reduce((s, c) => s + c.daysInStage, 0) / total) : 0;
    const atRisk = clients.filter((c) => c.risk?.level === 'high').length;
    return { total, advancing, avgDays, atRisk };
  }, [clients]);

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.trim().toLowerCase();
    return clients.filter((c) => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q));
  }, [clients, query]);

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Caseload</h1>
          <p className="mt-1 text-sm text-muted">Sorted by longest time since a stage change first.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show whole org
        </label>
      </div>

      {!loading && clients.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard label="Total clients" value={stats.total} accent="money" icon={<Users size={16} strokeWidth={1.75} />} />
          <StatCard label="Stacking or loan-ready" value={stats.advancing} accent="iris" icon={<TrendingUp size={16} strokeWidth={1.75} />} />
          <StatCard label="Avg. days in stage" value={stats.avgDays} icon={<Clock size={16} strokeWidth={1.75} />} />
          <StatCard label="At risk" value={stats.atRisk} accent={stats.atRisk > 0 ? 'gold' : undefined} icon={<AlertTriangle size={16} strokeWidth={1.75} />} />
        </div>
      )}

      {!loading && clients.length > 0 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="mb-4 w-full max-w-xs rounded-control border border-line px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none"
        />
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : clients.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center shadow-card">
          <p className="text-[15px] text-ink">No clients yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-6 py-3 font-normal">Client</th>
                <th className="px-6 py-3 font-normal">Plan</th>
                <th className="px-6 py-3 font-normal">Stage</th>
                <th className="px-6 py-3 font-normal">Days in stage</th>
                <th className="px-6 py-3 font-normal">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="px-6 py-4">
                    <Link href={`/caseload/${c.id}`} className="flex items-center gap-3 font-medium text-ink hover:underline">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line bg-paper text-[11px] font-medium text-ink">
                        {initials(c.first_name, c.last_name)}
                      </span>
                      {c.first_name} {c.last_name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-muted">{c.plan_tier.replace('_', ' ')}</td>
                  <td className="px-6 py-4">
                    <span className={`rounded-control px-2 py-1 text-xs font-medium ${STAGE_STYLE[c.journey_stage] ?? 'bg-line text-muted'}`}>{STAGE_LABELS[c.journey_stage] ?? c.journey_stage}</span>
                  </td>
                  <td className="figure px-6 py-4 text-muted">{c.daysInStage}</td>
                  <td className="px-6 py-4">
                    {c.risk?.level && c.risk.level !== 'low' ? (
                      <span title={c.risk.reasons.join(', ')} className={`rounded-control px-2 py-1 text-xs font-medium ${RISK_STYLE[c.risk.level]}`}>
                        {c.risk.level}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

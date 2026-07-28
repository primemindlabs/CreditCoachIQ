'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  first_name: string;
  last_name: string;
  plan_tier: string;
  journey_stage: string;
  journey_stage_updated_at: string;
  daysInStage: number;
}

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

export default function CaseloadPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/coach/caseload${showAll ? '?all=true' : ''}`)
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []))
      .finally(() => setLoading(false));
  }, [showAll]);

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

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : clients.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center">
          <p className="text-[15px] text-ink">No clients yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-6 py-3 font-normal">Client</th>
                <th className="px-6 py-3 font-normal">Plan</th>
                <th className="px-6 py-3 font-normal">Stage</th>
                <th className="px-6 py-3 font-normal">Days in stage</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="px-6 py-4">
                    <Link href={`/caseload/${c.id}`} className="font-medium text-ink hover:underline">{c.first_name} {c.last_name}</Link>
                  </td>
                  <td className="px-6 py-4 text-muted">{c.plan_tier.replace('_', ' ')}</td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_STYLE[c.journey_stage] ?? 'bg-line text-muted'}`}>{STAGE_LABELS[c.journey_stage] ?? c.journey_stage}</span>
                  </td>
                  <td className="px-6 py-4 text-muted">{c.daysInStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

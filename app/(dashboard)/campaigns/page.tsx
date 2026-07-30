'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type TriggerType = 'manual' | 'client_enrolled' | 'journey_stage_enter' | 'dispute_response_received' | 'goal_achieved' | 'stack_promo_expiring' | 'loan_ready_reached' | 'scheduled';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  trigger_type: TriggerType;
  status: 'draft' | 'active' | 'paused' | 'archived';
  campaign_steps: { id: string }[];
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  manual: 'Manual only',
  client_enrolled: 'On enrollment',
  journey_stage_enter: 'On stage change',
  dispute_response_received: 'On dispute response',
  goal_achieved: 'On goal achieved',
  stack_promo_expiring: 'Promo APR expiring',
  loan_ready_reached: 'On loan-ready',
  scheduled: 'Scheduled',
};

const STATUS_STYLE: Record<Campaign['status'], string> = {
  active: 'bg-money-tint text-money-hover',
  draft: 'bg-line text-muted',
  paused: 'bg-line text-muted',
  archived: 'bg-line text-muted',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('manual');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not load campaigns (${res.status}).`);
        return;
      }
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCampaign() {
    if (!name.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, trigger_type: triggerType }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not create this campaign (${res.status}).`);
        return;
      }
      setName('');
      setShowCreate(false);
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  return (
    <div>
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">Automated email and text sequences — built once, personalized per client at send time.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-control bg-money px-5 py-3 text-sm font-medium text-white hover:bg-money-hover">
          New campaign
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
      )}

      {showCreate && (
        <div className="mb-8 rounded-card border border-line bg-white p-6">
          <p className="mb-4 text-[15px] font-medium text-ink">New campaign</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1 block text-xs text-muted">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome sequence" className="w-full rounded-control border border-line px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Trigger</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)} className="rounded-control border border-line px-3 py-2 text-sm">
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <button onClick={createCampaign} className="rounded-control bg-money px-5 py-2.5 text-sm font-medium text-white hover:bg-money-hover">Create</button>
            <button onClick={() => setShowCreate(false)} className="rounded-control border border-line px-5 py-2.5 text-sm text-ink">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center">
          <p className="text-[15px] text-ink">No campaigns yet</p>
          <p className="mt-1 text-sm text-muted">Create one to start automating client touchpoints.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block rounded-card border border-line bg-white p-6 transition hover:border-ink/20">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[15px] font-medium text-ink">{c.name}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{c.status}</span>
              </div>
              <p className="text-sm text-muted">{TRIGGER_LABELS[c.trigger_type]} · {c.campaign_steps?.length ?? 0} step{(c.campaign_steps?.length ?? 0) === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

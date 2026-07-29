'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Template { id: string; name: string; channel: 'email' | 'sms'; subject: string | null }
interface Step {
  id?: string;
  step_order: number;
  channel: 'email' | 'sms';
  delay_hours: number;
  template_id: string;
  condition: { skip_if_stage_not?: string } | null;
  message_templates?: { id: string; name: string; channel: string; subject: string | null } | null;
}
interface Campaign { id: string; name: string; status: string; trigger_type: string; trigger_config: { stage?: string } | null }

const STAGES = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off'];

export default function CampaignBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newChannel, setNewChannel] = useState<'email' | 'sms'>('email');
  const [newTemplate, setNewTemplate] = useState('');
  const [newDelay, setNewDelay] = useState(24);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [campRes, tplRes] = await Promise.all([fetch(`/api/campaigns/${id}`), fetch('/api/templates')]);
    const campData = await campRes.json();
    const tplData = await tplRes.json();
    setCampaign(campData.campaign);
    setSteps((campData.steps ?? []).map((s: Step) => ({ ...s })));
    setTemplates(tplData.templates ?? []);
  }

  useEffect(() => { load(); }, [id]);

  function onDragStart(index: number) { setDragIndex(index); }
  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const next = [...steps];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setDragIndex(index);
    setSteps(next);
    setDirty(true);
  }
  function onDragEnd() { setDragIndex(null); }

  async function saveOrder() {
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: steps.map((s) => ({ channel: s.channel, template_id: s.template_id, delay_hours: s.delay_hours, condition: s.condition })) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not save step order (${res.status}).`);
        return;
      }
      setDirty(false);
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  async function addStep() {
    if (!newTemplate) return;
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: newChannel, template_id: newTemplate, delay_hours: newDelay }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not add that step (${res.status}).`);
        return;
      }
      setShowAdd(false);
      setNewTemplate('');
      setNewDelay(24);
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function setStatus(status: string) {
    setError(null);
    try {
      const res = await fetch('/api/campaigns', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not update status (${res.status}).`);
        return;
      }
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  async function setStageTrigger(stage: string) {
    setError(null);
    try {
      const res = await fetch('/api/campaigns', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, trigger_config: { stage } }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not update trigger (${res.status}).`);
        return;
      }
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  if (!campaign) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <button onClick={() => router.push('/campaigns')} className="mb-6 text-sm text-muted hover:text-ink">← All campaigns</button>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">{campaign.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {campaign.trigger_type === 'journey_stage_enter' ? 'Fires when a client enters a stage' : 'Automation sequence'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {campaign.status === 'active' ? (
            <button onClick={() => setStatus('paused')} className="rounded-control border border-line px-4 py-2 text-sm text-ink">Pause</button>
          ) : (
            <button onClick={() => setStatus('active')} className="rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">Activate</button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
      )}

      {campaign.trigger_type === 'journey_stage_enter' && (
        <div className="mb-8 rounded-card border border-line bg-white p-5">
          <label className="mb-1 block text-xs text-muted">Fires when client enters stage</label>
          <select value={campaign.trigger_config?.stage ?? ''} onChange={(e) => setStageTrigger(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm">
            <option value="">Select a stage…</option>
            {STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-[15px] font-medium text-ink">Steps</p>
        {dirty && <button onClick={saveOrder} className="rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">Save order</button>}
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={step.id ?? i}
            draggable
            onDragStart={() => onDragStart(i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDragEnd={onDragEnd}
            className="flex cursor-grab items-center gap-4 rounded-card border border-line bg-white p-5 active:cursor-grabbing"
          >
            <span className="text-muted">⠿</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-money-tint text-xs font-medium text-money-hover">{i + 1}</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{step.message_templates?.name ?? 'Template'} <span className="font-normal text-muted">· {step.channel}</span></p>
              <p className="text-xs text-muted">{step.delay_hours === 0 ? 'Sends immediately' : `${step.delay_hours}h after previous step`}{step.condition?.skip_if_stage_not ? ` · skipped unless client is in ${step.condition.skip_if_stage_not.replace(/_/g, ' ')}` : ''}</p>
            </div>
            <button onClick={() => removeStep(i)} className="text-sm text-muted hover:text-ink">Remove</button>
          </div>
        ))}

        {steps.length === 0 && (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-muted">
            No steps yet — add one below to start the sequence.
          </div>
        )}
      </div>

      {showAdd ? (
        <div className="mt-4 rounded-card border border-line bg-white p-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted">Channel</label>
              <select value={newChannel} onChange={(e) => { setNewChannel(e.target.value as 'email' | 'sms'); setNewTemplate(''); }} className="rounded-control border border-line px-3 py-2 text-sm">
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs text-muted">Template</label>
              <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm">
                <option value="">Select…</option>
                {templates.filter((t) => t.channel === newChannel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Delay (hours after previous)</label>
              <input type="number" min={0} value={newDelay} onChange={(e) => setNewDelay(Number(e.target.value))} className="w-28 rounded-control border border-line px-3 py-2 text-sm" />
            </div>
            <button onClick={addStep} className="rounded-control bg-money px-5 py-2.5 text-sm font-medium text-white hover:bg-money-hover">Add step</button>
            <button onClick={() => setShowAdd(false)} className="rounded-control border border-line px-5 py-2.5 text-sm text-ink">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="mt-4 w-full rounded-card border border-dashed border-line bg-white py-4 text-sm text-muted hover:border-money hover:text-money">
          + Add step
        </button>
      )}
    </div>
  );
}

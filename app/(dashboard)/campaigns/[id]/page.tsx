'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Zap, Mail, MessageSquare, CheckCircle2 } from 'lucide-react';
import Eyebrow from '@/components/ui/Eyebrow';

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
interface Enrollment { id: string; status: string; current_step_order: number; enrolled_at: string; completed_at: string | null; borrowers: { id: string; first_name: string; last_name: string } | null }
interface PickPerson { id: string; first_name: string; last_name: string }

const STAGES = ['credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off'];
const PICKER_SEGMENTS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active clients' },
  { value: 'leads', label: 'Leads' },
  { value: 'funded', label: 'Funded' },
  { value: 'denied', label: 'Denied' },
];

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

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [showEnroll, setShowEnroll] = useState(false);
  const [pickerSegment, setPickerSegment] = useState('active');
  const [pickerPeople, setPickerPeople] = useState<PickPerson[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);
  const [enrollResult, setEnrollResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [campRes, tplRes] = await Promise.all([fetch(`/api/campaigns/${id}`), fetch('/api/templates')]);
      if (!campRes.ok) {
        const d = await campRes.json().catch(() => ({}));
        setError(d.error ?? `Could not load this campaign (${campRes.status}).`);
        return;
      }
      if (!tplRes.ok) {
        const d = await tplRes.json().catch(() => ({}));
        setError(d.error ?? `Could not load templates (${tplRes.status}).`);
        return;
      }
      const campData = await campRes.json();
      const tplData = await tplRes.json();
      setCampaign(campData.campaign);
      setSteps((campData.steps ?? []).map((s: Step) => ({ ...s })));
      setTemplates(tplData.templates ?? []);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const loadEnrollments = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}/enroll`);
      if (res.ok) {
        const d = await res.json();
        setEnrollments(d.enrollments ?? []);
      }
    } catch {
      // Non-critical — the enrolled-clients list just won't refresh this pass.
    }
  }, [id]);

  useEffect(() => { loadEnrollments(); }, [loadEnrollments]);

  const loadPicker = useCallback(async (segment: string) => {
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/coach/clients?segment=${segment}&all=true`);
      if (res.ok) {
        const d = await res.json();
        setPickerPeople(d.people ?? []);
      }
    } catch {
      // Non-critical — picker list just stays empty; try again by reopening.
    } finally {
      setPickerLoading(false);
    }
  }, []);

  useEffect(() => { if (showEnroll) loadPicker(pickerSegment); }, [showEnroll, pickerSegment, loadPicker]);

  function togglePick(personId: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId); else next.add(personId);
      return next;
    });
  }

  async function enrollPicked() {
    if (pickedIds.size === 0) return;
    setEnrolling(true);
    setEnrollResult(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowerIds: Array.from(pickedIds) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEnrollResult(d.error ?? `Could not enroll that group (${res.status}).`);
        return;
      }
      setEnrollResult(`Enrolled ${d.enrolled} client${d.enrolled === 1 ? '' : 's'}.`);
      setPickedIds(new Set());
      loadEnrollments();
    } catch {
      setEnrollResult('Could not reach the server.');
    } finally {
      setEnrolling(false);
    }
  }

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

  if (!campaign) {
    return error ? (
      <div className="rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
    ) : (
      <p className="text-sm text-muted">Loading…</p>
    );
  }

  return (
    <div>
      <button onClick={() => router.push('/campaigns')} className="mb-6 text-sm text-muted hover:text-ink">← All campaigns</button>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <Eyebrow label="Automation" accent="iris" />
          <h1 className="mt-2 text-[32px] font-medium leading-[1.05] tracking-tight text-ink">{campaign.name}</h1>
          <p className="mt-2 text-sm text-muted">
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

      <div className="mb-8 rounded-card border border-line bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[15px] font-medium text-ink">Enrolled clients</p>
            <p className="mt-0.5 text-xs text-muted">{enrollments.length} enrolled, add people individually or as a group below.</p>
          </div>
          <button onClick={() => setShowEnroll((s) => !s)} className="rounded-control border border-line px-3.5 py-2 text-sm text-ink hover:border-ink/30">
            {showEnroll ? 'Close' : 'Add clients'}
          </button>
        </div>

        {enrollments.length > 0 && (
          <div className="mb-4 space-y-2">
            {enrollments.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                <span className="text-ink">{e.borrowers ? `${e.borrowers.first_name} ${e.borrowers.last_name}` : 'Client removed'}</span>
                <span className="text-xs text-muted">{e.status}, step {e.current_step_order}</span>
              </div>
            ))}
            {enrollments.length > 8 && <p className="text-xs text-muted">+ {enrollments.length - 8} more</p>}
          </div>
        )}

        {showEnroll && (
          <div className="rounded-control border border-line bg-paper p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select value={pickerSegment} onChange={(e) => setPickerSegment(e.target.value)} className="rounded-control border border-line px-2.5 py-1.5 text-sm text-ink">
                {PICKER_SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by name…"
                className="min-w-[200px] flex-1 rounded-control border border-line px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
              />
              <button onClick={enrollPicked} disabled={enrolling || pickedIds.size === 0} className="rounded-control bg-money px-3.5 py-1.5 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
                {enrolling ? 'Enrolling…' : `Enroll ${pickedIds.size || ''}`.trim()}
              </button>
            </div>
            {enrollResult && <p className="mb-3 text-xs text-ink">{enrollResult}</p>}
            {pickerLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {pickerPeople
                  .filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
                  .map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded-control px-2 py-1.5 text-sm text-ink hover:bg-white">
                      <input type="checkbox" checked={pickedIds.has(p.id)} onChange={() => togglePick(p.id)} className="rounded border-line" />
                      {p.first_name} {p.last_name}
                    </label>
                  ))}
                {pickerPeople.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">Nobody in this segment.</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-[15px] font-medium text-ink">Flow</p>
        {dirty && <button onClick={saveOrder} className="rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover">Save order</button>}
      </div>

      {/* Visual flow: trigger at top, each step connected by a line labeled
          with its delay, ending in a completion node. Steps stay draggable
          on the node itself (same reorder logic as before), this just
          renders the sequence as a connected canvas instead of a plain list
          so the automation actually reads as a flow at a glance. */}
      <div className="flex flex-col items-center rounded-card border border-line bg-paper/60 p-8">
        <div className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 shadow-card">
          <Zap size={14} strokeWidth={1.75} className="text-gold" />
          <span className="text-sm font-medium text-ink">
            {campaign.trigger_type === 'journey_stage_enter' && campaign.trigger_config?.stage
              ? `Enters ${campaign.trigger_config.stage.replace(/_/g, ' ')}`
              : campaign.trigger_type.replace(/_/g, ' ')}
          </span>
        </div>

        {steps.map((step, i) => (
          <div key={step.id ?? i} className="flex flex-col items-center">
            <div className="flex flex-col items-center py-1">
              <div className="h-6 w-px bg-line" />
              <span className="my-0.5 rounded-full border border-line bg-white px-2 py-0.5 text-[10px] text-muted">
                {step.delay_hours === 0 ? 'immediately' : `+${step.delay_hours}h`}
              </span>
              <div className="h-6 w-px bg-line" />
            </div>
            <div
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              className="flex w-80 cursor-grab items-center gap-3 rounded-card border border-line bg-white p-4 shadow-card active:cursor-grabbing"
            >
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${step.channel === 'email' ? 'bg-iris-tint text-iris' : 'bg-money-tint text-money-hover'}`}>
                {step.channel === 'email' ? <Mail size={15} strokeWidth={1.75} /> : <MessageSquare size={15} strokeWidth={1.75} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{step.message_templates?.name ?? 'Template'}</p>
                <p className="truncate text-xs text-muted">
                  Step {i + 1}, {step.channel}{step.condition?.skip_if_stage_not ? `, skipped unless in ${step.condition.skip_if_stage_not.replace(/_/g, ' ')}` : ''}
                </p>
              </div>
              <button onClick={() => removeStep(i)} className="shrink-0 text-xs text-muted hover:text-terra">Remove</button>
            </div>
          </div>
        ))}

        {steps.length > 0 && (
          <div className="flex flex-col items-center py-1">
            <div className="h-6 w-px bg-line" />
            <div className="mt-1 flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs text-muted">
              <CheckCircle2 size={13} strokeWidth={1.75} className="text-money" /> Sequence complete
            </div>
          </div>
        )}

        {steps.length === 0 && (
          <div className="mt-6 rounded-card border border-dashed border-line bg-white p-8 text-center text-sm text-muted">
            No steps yet. Add one below to start the sequence.
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

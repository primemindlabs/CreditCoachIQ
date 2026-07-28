'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';

interface Complaint {
  id: string;
  borrower_id: string;
  filed_by: string;
  category: string;
  description: string;
  status: string;
  resolution_notes: string | null;
  opened_at: string;
  resolved_at: string | null;
  borrowers: { first_name: string; last_name: string } | null;
}

interface ClientOption { id: string; first_name: string; last_name: string; }

const CATEGORIES = ['billing', 'service_quality', 'dispute_handling', 'communication', 'data_privacy', 'other'];
const FILED_BY = ['client', 'coach', 'bureau', 'third_party'];
const STATUSES = ['open', 'investigating', 'resolved', 'escalated_cfpb'];

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-terra-tint text-terra',
  investigating: 'bg-gold-tint text-ink',
  resolved: 'bg-money-tint text-money-hover',
  escalated_cfpb: 'bg-ink text-white',
};

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ borrowerId: '', filedBy: 'client', category: 'service_quality', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, cl] = await Promise.all([
      fetch('/api/compliance/complaints').then((r) => r.json()),
      fetch('/api/coach/caseload?all=true').then((r) => r.json()),
    ]);
    setComplaints(c.complaints ?? []);
    setClients(cl.clients ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const open = complaints.filter((c) => c.status === 'open').length;
    const investigating = complaints.filter((c) => c.status === 'investigating').length;
    const escalated = complaints.filter((c) => c.status === 'escalated_cfpb').length;
    return { open, investigating, escalated };
  }, [complaints]);

  async function submit() {
    if (!form.borrowerId || !form.description.trim()) return;
    setSubmitting(true);
    await fetch('/api/compliance/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    setShowForm(false);
    setForm({ borrowerId: '', filedBy: 'client', category: 'service_quality', description: '' });
    load();
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/compliance/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Complaint log</h1>
          <p className="mt-1 text-sm text-muted">A durable record of any complaint or dispute-handling escalation — CROA-adjacent best practice.</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="rounded-control bg-gradient-money px-4 py-2.5 text-sm font-medium text-white shadow-glow-money">
          {showForm ? 'Cancel' : 'Log a complaint'}
        </button>
      </div>

      {!loading && complaints.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Open" value={stats.open} accent="gold" icon={<AlertTriangle size={16} strokeWidth={1.75} />} />
          <StatCard label="Investigating" value={stats.investigating} />
          <StatCard label="Escalated to CFPB" value={stats.escalated} accent="iris" icon={<ShieldAlert size={16} strokeWidth={1.75} />} />
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-card border border-line bg-white p-6 shadow-card">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm text-ink">
              Client
              <select value={form.borrowerId} onChange={(e) => setForm({ ...form, borrowerId: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm">
                <option value="">Select a client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </label>
            <label className="text-sm text-ink">
              Filed by
              <select value={form.filedBy} onChange={(e) => setForm({ ...form, filedBy: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm">
                {FILED_BY.map((f) => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label className="text-sm text-ink sm:col-span-2">
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label className="text-sm text-ink sm:col-span-2">
              Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm" />
            </label>
          </div>
          <button onClick={submit} disabled={submitting} className="mt-4 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
            {submitting ? 'Logging…' : 'Log complaint'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : complaints.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center shadow-card">
          <p className="text-[15px] text-ink">No complaints logged</p>
        </div>
      ) : (
        <div className="space-y-3">
          {complaints.map((c) => (
            <div key={c.id} className="rounded-card border border-line bg-white p-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {c.borrowers ? `${c.borrowers.first_name} ${c.borrowers.last_name}` : 'Unknown client'} · {c.category.replace('_', ' ')}
                  </p>
                  <p className="mt-1 text-xs text-muted">Filed by {c.filed_by.replace('_', ' ')} · {new Date(c.opened_at).toLocaleDateString()}</p>
                  <p className="mt-2 text-sm text-ink">{c.description}</p>
                </div>
                <select
                  value={c.status}
                  onChange={(e) => updateStatus(c.id, e.target.value)}
                  className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[c.status] ?? 'bg-line text-muted'}`}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

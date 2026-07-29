'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { UserPlus, Flame, Users } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';

interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  lead_status: string;
  interest_level: string | null;
  lead_source: string;
  last_contacted_at: string | null;
  created_at: string;
}

const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
const INTEREST_LEVELS = ['hot', 'warm', 'cold'];

const STATUS_STYLE: Record<string, string> = {
  new: 'bg-iris-tint text-iris',
  contacted: 'bg-gold-tint text-ink',
  qualified: 'bg-money-tint text-money-hover',
  converted: 'bg-money text-white',
  lost: 'bg-line text-muted',
};

const INTEREST_STYLE: Record<string, string> = {
  hot: 'bg-terra-tint text-terra',
  warm: 'bg-gold-tint text-ink',
  cold: 'bg-line text-muted',
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', leadSource: 'manual', interestLevel: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/leads').then((r) => r.json());
    setLeads(d.leads ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const total = leads.length;
    const hot = leads.filter((l) => l.interest_level === 'hot').length;
    const uncontacted = leads.filter((l) => l.lead_status === 'new').length;
    return { total, hot, uncontacted };
  }, [leads]);

  async function submit() {
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSubmitting(true);
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, interestLevel: form.interestLevel || undefined }),
    });
    setSubmitting(false);
    setShowForm(false);
    setForm({ firstName: '', lastName: '', email: '', phone: '', leadSource: 'manual', interestLevel: '' });
    load();
  }

  async function updateField(id: string, patch: { status?: string; interestLevel?: string }) {
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    load();
  }

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Leads</h1>
          <p className="mt-1 text-sm text-muted">Prospects before enrollment. Convert a lead from their detail page once they're ready.</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="flex items-center gap-1.5 rounded-control bg-gradient-money px-4 py-2.5 text-sm font-medium text-white shadow-glow-money">
          <UserPlus size={14} strokeWidth={1.75} /> {showForm ? 'Cancel' : 'Add lead'}
        </button>
      </div>

      {!loading && leads.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total leads" value={stats.total} icon={<Users size={16} strokeWidth={1.75} />} />
          <StatCard label="Hot" value={stats.hot} accent={stats.hot > 0 ? 'gold' : undefined} icon={<Flame size={16} strokeWidth={1.75} />} />
          <StatCard label="Not yet contacted" value={stats.uncontacted} accent={stats.uncontacted > 0 ? 'iris' : undefined} />
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-card border border-line bg-white p-6 shadow-card">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm text-ink">
              First name
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-ink">
              Last name
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-ink">
              Email
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-ink">
              Phone
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-ink">
              Source
              <input value={form.leadSource} onChange={(e) => setForm({ ...form, leadSource: e.target.value })} placeholder="referral, quiz, walk-in…" className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-ink">
              Interest level
              <select value={form.interestLevel} onChange={(e) => setForm({ ...form, interestLevel: e.target.value })} className="mt-1 w-full rounded-control border border-line px-3 py-2 text-sm">
                <option value="">Not set</option>
                {INTEREST_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
          <button onClick={submit} disabled={submitting} className="mt-4 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
            {submitting ? 'Adding…' : 'Add lead'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : leads.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center shadow-card">
          <p className="text-[15px] text-ink">No leads yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-6 py-3 font-normal">Lead</th>
                <th className="px-6 py-3 font-normal">Source</th>
                <th className="px-6 py-3 font-normal">Status</th>
                <th className="px-6 py-3 font-normal">Interest</th>
                <th className="px-6 py-3 font-normal">Last contacted</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="px-6 py-4">
                    <Link href={`/caseload/${l.id}`} className="font-medium text-ink hover:underline">
                      {l.first_name} {l.last_name}
                    </Link>
                    <p className="text-xs text-muted">{l.email ?? l.phone ?? 'No contact info'}</p>
                  </td>
                  <td className="px-6 py-4 text-muted">{l.lead_source.replace('_', ' ')}</td>
                  <td className="px-6 py-4">
                    <select
                      value={l.lead_status}
                      onChange={(e) => updateField(l.id, { status: e.target.value })}
                      className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[l.lead_status] ?? 'bg-line text-muted'}`}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={l.interest_level ?? ''}
                      onChange={(e) => updateField(l.id, { interestLevel: e.target.value })}
                      className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${l.interest_level ? INTEREST_STYLE[l.interest_level] : 'bg-line text-muted'}`}
                    >
                      <option value="">—</option>
                      {INTEREST_LEVELS.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4 text-muted">{l.last_contacted_at ? new Date(l.last_contacted_at).toLocaleDateString() : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

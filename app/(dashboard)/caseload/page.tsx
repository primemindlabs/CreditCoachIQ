'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';

type Segment = 'leads' | 'active' | 'funded' | 'denied';

interface Person {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  plan_tier: string;
  lead_status: string;
  interest_level: string | null;
  lead_source: string;
  last_contacted_at: string | null;
  journey_stage: string;
  journey_stage_updated_at: string | null;
  funding_status: string | null;
  funding_status_updated_at: string | null;
  daysInStage: number | null;
  risk: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] } | null;
  created_at: string;
}

interface Agent { id: string; first_name: string; last_name: string; role: string }

const TABS: { value: Segment; label: string }[] = [
  { value: 'leads', label: 'Leads' },
  { value: 'active', label: 'Active clients' },
  { value: 'funded', label: 'Funded' },
  { value: 'denied', label: 'Denied' },
];

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
const INTEREST_LEVELS = ['hot', 'warm', 'cold'];
const RISK_LEVELS = ['high', 'medium', 'low'];

const STAGE_LABELS: Record<string, string> = {
  credit_coaching: 'Credit coaching', credit_stacking: 'Credit stacking',
  loan_ready: 'Loan ready', handed_off: 'Handed off', paused: 'Paused', exited: 'Exited',
};
const STAGE_STYLE: Record<string, string> = {
  credit_coaching: 'bg-line text-muted', credit_stacking: 'bg-money-tint text-money-hover',
  loan_ready: 'bg-money-tint text-money-hover', handed_off: 'bg-money text-white',
  paused: 'bg-terra-tint text-terra', exited: 'bg-line text-muted',
};
const FUNDING_LABELS: Record<string, string> = {
  pre_qual: 'Pre-qual', processing: 'Processing', underwriting: 'Underwriting',
  clear_to_close: 'Clear to close', funded: 'Funded', declined: 'Declined', withdrawn: 'Withdrawn',
};
const RISK_STYLE: Record<string, string> = { high: 'bg-terra-tint text-terra', medium: 'bg-gold-tint text-ink', low: 'bg-line text-muted' };
const STATUS_STYLE: Record<string, string> = {
  new: 'bg-iris-tint text-iris', contacted: 'bg-gold-tint text-ink', qualified: 'bg-money-tint text-money-hover',
  converted: 'bg-money text-white', lost: 'bg-line text-muted',
};
const INTEREST_STYLE: Record<string, string> = { hot: 'bg-terra-tint text-terra', warm: 'bg-gold-tint text-ink', cold: 'bg-line text-muted' };

function initials(first: string, last: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

export default function ClientsPage() {
  const [tab, setTab] = useState<Segment>('leads');
  const [people, setPeople] = useState<Person[]>([]);
  const [counts, setCounts] = useState<Record<Segment, number>>({ leads: 0, active: 0, funded: 0, denied: 0 });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canManageIntake, setCanManageIntake] = useState(false);
  const [canManageCaseload, setCanManageCaseload] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAllOrg, setShowAllOrg] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', leadSource: 'manual', interestLevel: '' });
  const [submitting, setSubmitting] = useState(false);

  // Segment-specific filters — kept client-side over the already-loaded
  // (max 200-row) segment rather than round-tripping the server, since the
  // whole point is fast toggling while scanning a list that's already local.
  const [statusFilter, setStatusFilter] = useState('');
  const [interestFilter, setInterestFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<Agent[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [bulkReassignTo, setBulkReassignTo] = useState('');
  const [bulkSmsDraft, setBulkSmsDraft] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const load = useCallback(async (segment: Segment, all: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach/clients?segment=${segment}${all ? '&all=true' : ''}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not load this list (${res.status}).`);
        setPeople([]);
        return;
      }
      const d = await res.json();
      setPeople(d.people ?? []);
      setCounts(d.counts ?? { leads: 0, active: 0, funded: 0, denied: 0 });
      setCanManageIntake(!!d.canManageIntake);
      setCanManageCaseload(!!d.canManageCaseload);
      setIsAdmin(!!d.isAdmin);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab, showAllOrg); }, [tab, showAllOrg, load]);

  // Selection and filters don't carry meaning across tabs — reset on switch.
  useEffect(() => {
    setSelectedIds(new Set());
    setStatusFilter(''); setInterestFilter(''); setSourceFilter('');
    setStageFilter(''); setRiskFilter('');
    setBulkResult(null);
  }, [tab]);

  const sources = useMemo(() => Array.from(new Set(people.map((p) => p.lead_source).filter(Boolean))).sort(), [people]);

  const filtered = useMemo(() => {
    let list = people;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q));
    }
    if (tab === 'leads') {
      if (statusFilter) list = list.filter((p) => p.lead_status === statusFilter);
      if (interestFilter) list = list.filter((p) => p.interest_level === interestFilter);
      if (sourceFilter) list = list.filter((p) => p.lead_source === sourceFilter);
    }
    if (tab === 'active') {
      if (stageFilter) list = list.filter((p) => p.journey_stage === stageFilter);
      if (riskFilter) list = list.filter((p) => p.risk?.level === riskFilter);
    }
    return list;
  }, [people, query, tab, statusFilter, interestFilter, sourceFilter, stageFilter, riskFilter]);

  async function loadRoster() {
    if (rosterLoaded) return;
    try {
      const res = await fetch('/api/coach/roster');
      if (res.ok) {
        const d = await res.json();
        setRoster(d.agents ?? []);
      }
    } catch {
      // Non-critical — reassign dropdown just stays empty; the button will still surface a server error on submit.
    } finally {
      setRosterLoaded(true);
    }
  }

  async function submitLead() {
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, interestLevel: form.interestLevel || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not save this lead (${res.status}).`);
        return;
      }
      setShowForm(false);
      setForm({ firstName: '', lastName: '', email: '', phone: '', leadSource: 'manual', interestLevel: '' });
      load('leads', showAllOrg);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateLeadField(id: string, patch: { status?: string; interestLevel?: string }) {
    setError(null);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not update this lead (${res.status}).`);
        return;
      }
      load('leads', showAllOrg);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id))));
  }

  async function bulkReassign() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await fetch('/api/coach/clients/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reassign', borrowerIds: Array.from(selectedIds), assignedTo: bulkReassignTo || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkResult(d.error ?? `Could not reassign (${res.status}).`);
        return;
      }
      setBulkResult(`Reassigned ${d.updated ?? selectedIds.size} client(s).`);
      setSelectedIds(new Set());
      load(tab, showAllOrg);
    } catch {
      setBulkResult('Could not reach the server. Check your connection and try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSendSms() {
    if (selectedIds.size === 0 || !bulkSmsDraft.trim()) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await fetch('/api/coach/clients/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sms', borrowerIds: Array.from(selectedIds), body: bulkSmsDraft.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkResult(d.error ?? `Could not send (${res.status}).`);
        return;
      }
      const results: { status: string }[] = d.results ?? [];
      const sent = results.filter((r) => r.status === 'sent').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      setBulkResult(`Sent ${sent}${skipped ? `, skipped ${skipped} (no consent/phone)` : ''}${failed ? `, ${failed} failed` : ''}.`);
      setBulkSmsDraft('');
      setSelectedIds(new Set());
    } catch {
      setBulkResult('Could not reach the server. Check your connection and try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Clients</h1>
          <p className="mt-1 text-sm text-muted">Everyone in the pipeline — prospect to funded — in one place.</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input type="checkbox" checked={showAllOrg} onChange={(e) => setShowAllOrg(e.target.checked)} className="rounded border-line" />
              Show whole org
            </label>
          )}
          {tab === 'leads' && canManageIntake && (
            <button onClick={() => setShowForm((s) => !s)} className="flex items-center gap-1.5 rounded-control bg-ink px-3.5 py-2 text-sm font-medium text-white hover:bg-ink/90">
              <UserPlus size={14} strokeWidth={1.75} /> {showForm ? 'Cancel' : 'Add lead'}
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${
              tab === t.value ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            <span className="figure rounded-full bg-line px-1.5 py-0.5 text-[11px] text-muted">{counts[t.value]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6 rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
      )}

      {showForm && tab === 'leads' && (
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
          <button onClick={submitLead} disabled={submitting} className="mt-4 rounded-control bg-money px-4 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-50">
            {submitting ? 'Adding…' : 'Add lead'}
          </button>
        </div>
      )}

      {!loading && people.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full max-w-xs rounded-control border border-line px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none"
          />
          {tab === 'leads' && (
            <>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm text-ink">
                <option value="">All statuses</option>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={interestFilter} onChange={(e) => setInterestFilter(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm text-ink">
                <option value="">All interest</option>
                {INTEREST_LEVELS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              {sources.length > 0 && (
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm text-ink">
                  <option value="">All sources</option>
                  {sources.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              )}
            </>
          )}
          {tab === 'active' && (
            <>
              <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm text-ink">
                <option value="">All stages</option>
                {Object.entries(STAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm text-ink">
                <option value="">All risk</option>
                {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      {canManageCaseload && selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper p-4">
          <span className="text-sm font-medium text-ink">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            <select
              value={bulkReassignTo}
              onFocus={loadRoster}
              onChange={(e) => setBulkReassignTo(e.target.value)}
              className="rounded-control border border-line px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Unassigned</option>
              {roster.map((a) => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
            </select>
            <button onClick={bulkReassign} disabled={bulkBusy} className="rounded-control border border-line px-3 py-1.5 text-sm text-ink hover:border-ink/30 disabled:opacity-60">
              Reassign
            </button>
          </div>
          <div className="flex min-w-[280px] flex-1 items-center gap-1.5">
            <input
              value={bulkSmsDraft}
              onChange={(e) => setBulkSmsDraft(e.target.value)}
              placeholder="Text this group…"
              className="min-w-0 flex-1 rounded-control border border-line px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
            />
            <button onClick={bulkSendSms} disabled={bulkBusy || !bulkSmsDraft.trim()} className="shrink-0 rounded-control bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-60">
              Send
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-muted hover:text-ink">Clear</button>
        </div>
      )}

      {bulkResult && (
        <div className="mb-4 rounded-control border border-line bg-paper px-4 py-2.5 text-sm text-ink">{bulkResult}</div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-12 text-center shadow-card">
          <p className="text-[15px] text-ink">Nobody here yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                {canManageCaseload && (
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === filtered.length} onChange={toggleSelectAll} className="rounded border-line" />
                  </th>
                )}
                <th className="px-6 py-3 font-normal">{tab === 'leads' ? 'Lead' : 'Client'}</th>
                {tab === 'leads' && <th className="px-6 py-3 font-normal">Source</th>}
                {tab === 'leads' && <th className="px-6 py-3 font-normal">Status</th>}
                {tab === 'leads' && <th className="px-6 py-3 font-normal">Interest</th>}
                {tab === 'leads' && <th className="px-6 py-3 font-normal">Last contacted</th>}
                {tab === 'active' && <th className="px-6 py-3 font-normal">Stage</th>}
                {tab === 'active' && <th className="px-6 py-3 font-normal">Days in stage</th>}
                {tab === 'active' && <th className="px-6 py-3 font-normal">Risk</th>}
                {(tab === 'funded' || tab === 'denied') && <th className="px-6 py-3 font-normal">Status</th>}
                {(tab === 'funded' || tab === 'denied') && <th className="px-6 py-3 font-normal">Updated</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-paper">
                  {canManageCaseload && (
                    <td className="px-4 py-4">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded border-line" />
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <Link href={`/caseload/${p.id}`} className="flex items-center gap-3 font-medium text-ink hover:underline">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line bg-paper text-[11px] font-medium text-ink">
                        {initials(p.first_name, p.last_name)}
                      </span>
                      <span>
                        {p.first_name} {p.last_name}
                        {tab !== 'leads' && <span className="block text-xs font-normal text-muted">{p.email ?? p.phone ?? ''}</span>}
                      </span>
                    </Link>
                  </td>

                  {tab === 'leads' && <td className="px-6 py-4 text-muted">{p.lead_source?.replace('_', ' ')}</td>}
                  {tab === 'leads' && (
                    <td className="px-6 py-4">
                      <select
                        value={p.lead_status}
                        onChange={(e) => updateLeadField(p.id, { status: e.target.value })}
                        className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.lead_status] ?? 'bg-line text-muted'}`}
                      >
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  )}
                  {tab === 'leads' && (
                    <td className="px-6 py-4">
                      <select
                        value={p.interest_level ?? ''}
                        onChange={(e) => updateLeadField(p.id, { interestLevel: e.target.value })}
                        className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${p.interest_level ? INTEREST_STYLE[p.interest_level] : 'bg-line text-muted'}`}
                      >
                        <option value="">—</option>
                        {INTEREST_LEVELS.map((i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </td>
                  )}
                  {tab === 'leads' && <td className="px-6 py-4 text-muted">{p.last_contacted_at ? new Date(p.last_contacted_at).toLocaleDateString() : 'Never'}</td>}

                  {tab === 'active' && (
                    <td className="px-6 py-4">
                      <span className={`rounded-control px-2 py-1 text-xs font-medium ${STAGE_STYLE[p.journey_stage] ?? 'bg-line text-muted'}`}>{STAGE_LABELS[p.journey_stage] ?? p.journey_stage}</span>
                    </td>
                  )}
                  {tab === 'active' && <td className="figure px-6 py-4 text-muted">{p.daysInStage ?? '—'}</td>}
                  {tab === 'active' && (
                    <td className="px-6 py-4">
                      {p.risk?.level && p.risk.level !== 'low' ? (
                        <span title={p.risk.reasons.join(', ')} className={`rounded-control px-2 py-1 text-xs font-medium ${RISK_STYLE[p.risk.level]}`}>{p.risk.level}</span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  )}

                  {(tab === 'funded' || tab === 'denied') && (
                    <td className="px-6 py-4">
                      <span className={`rounded-control px-2 py-1 text-xs font-medium ${tab === 'funded' ? 'bg-money text-white' : 'bg-terra-tint text-terra'}`}>
                        {FUNDING_LABELS[p.funding_status ?? ''] ?? p.funding_status}
                      </span>
                    </td>
                  )}
                  {(tab === 'funded' || tab === 'denied') && (
                    <td className="px-6 py-4 text-muted">{p.funding_status_updated_at ? new Date(p.funding_status_updated_at).toLocaleDateString() : '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

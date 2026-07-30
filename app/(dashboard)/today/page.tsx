'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { CheckSquare, Phone, MessageCircle, AlertTriangle, CreditCard, UserPlus } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';

interface BorrowerRef { first_name: string; last_name: string }
interface TaskItem { id: string; type: string | null; title: string; due_date: string | null; borrower_id: string | null; borrowers: BorrowerRef | null }
interface CallItem { id: string; scheduled_at: string; borrower_id: string; borrowers: BorrowerRef | null }
interface MessageItem { id: string; borrower_id: string; body: string; created_at: string; borrowers: BorrowerRef | null }
interface ComplaintItem { id: string; borrower_id: string; category: string; status: string; opened_at: string; borrowers: BorrowerRef | null }
interface PaymentItem { id: string; borrower_id: string; last_payment_failed_at: string; payment_retry_count: number; borrowers: BorrowerRef | null }

interface ExternalEvent { id: string; summary: string; startISO: string | null }

interface Today {
  tasks: TaskItem[];
  todayCalls: CallItem[];
  upcomingCalls: CallItem[];
  externalTodayEvents: ExternalEvent[];
  unreadMessages: MessageItem[];
  unreadTexts: MessageItem[];
  openComplaints: ComplaintItem[];
  paymentFailures: PaymentItem[];
  newLeadsCount: number;
  scoreJumps: { borrowerId: string; delta: number; name: string }[];
}

function name(b: BorrowerRef | null): string {
  return b ? `${b.first_name} ${b.last_name}` : 'Unknown client';
}

export default function TodayPage() {
  const [data, setData] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/coach/today').then((r) => r.json());
    setData(d);
    setLoading(false);
    setBriefingLoading(true);
    fetch('/api/coach/today/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    })
      .then((r) => r.json())
      .then((b) => setBriefing(b.briefing))
      .finally(() => setBriefingLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function completeTask(id: string) {
    setError(null);
    try {
      const res = await fetch('/api/coach/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, completed: true }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Could not complete that task (${res.status}).`);
        return;
      }
      load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  const needsAttention = useMemo(() => {
    if (!data) return 0;
    return data.tasks.length + data.unreadMessages.length + data.unreadTexts.length + data.openComplaints.length + data.paymentFailures.length;
  }, [data]);

  if (loading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 border-b border-line pb-8">
        <p className="text-[12px] uppercase tracking-wide text-muted">Today</p>
        <h1 className="mt-1 text-[34px] font-medium leading-tight text-ink">
          {needsAttention === 0 ? "You're all caught up" : (
            <>
              <span className="figure">{needsAttention}</span> thing{needsAttention === 1 ? '' : 's'} need your attention
            </>
          )}
        </h1>
        <p className="mt-3 max-w-2xl border-l-2 border-l-line pl-3 text-sm text-muted">
          {briefingLoading ? 'Writing your briefing…' : (briefing ?? 'Everything below is pulled live.')}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-control border border-terra/30 bg-terra-tint px-4 py-3 text-sm text-terra">{error}</div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-5">
        <StatCard label="Open tasks" value={data.tasks.length} accent={data.tasks.length > 0 ? 'iris' : undefined} icon={<CheckSquare size={16} strokeWidth={1.75} />} />
        <StatCard label="Calls today" value={data.todayCalls.length} accent={data.todayCalls.length > 0 ? 'money' : undefined} icon={<Phone size={16} strokeWidth={1.75} />} />
        <StatCard label="Unread messages" value={data.unreadMessages.length + data.unreadTexts.length} accent={(data.unreadMessages.length + data.unreadTexts.length) > 0 ? 'gold' : undefined} icon={<MessageCircle size={16} strokeWidth={1.75} />} />
        <StatCard label="Needs review" value={data.openComplaints.length + data.paymentFailures.length} accent={(data.openComplaints.length + data.paymentFailures.length) > 0 ? 'money' : undefined} icon={<AlertTriangle size={16} strokeWidth={1.75} />} />
        <Link href="/caseload" className="block transition-opacity hover:opacity-90">
          <StatCard label="New leads" value={data.newLeadsCount} accent={data.newLeadsCount > 0 ? 'iris' : undefined} icon={<UserPlus size={16} strokeWidth={1.75} />} />
        </Link>
      </div>

      {/* Today's call list — surfaced first and on its own, matching the
          "pending calls on login" pattern coaches expect from a CRM. */}
      <div className="mb-6 rounded-card border border-line border-l-2 border-l-money bg-white p-6 shadow-card">
        <p className="mb-4 text-sm font-medium text-ink">Today&apos;s calls</p>
        {data.todayCalls.length === 0 && data.externalTodayEvents.length === 0 ? (
          <p className="text-sm text-muted">Nothing on the books for today.</p>
        ) : (
          <div className="space-y-3">
            {data.todayCalls.map((c) => (
              <Link key={c.id} href={`/caseload/${c.borrower_id}`} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                <span className="flex items-center gap-1.5 text-ink"><Phone size={13} strokeWidth={1.75} /> {name(c.borrowers)}</span>
                <span className="figure text-muted">{new Date(c.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </Link>
            ))}
            {data.externalTodayEvents.map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                <span className="flex items-center gap-1.5 text-ink">{e.summary} <span className="text-xs text-muted">· Google Calendar</span></span>
                <span className="figure text-muted">{e.startISO ? new Date(e.startISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'All day'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-4 text-sm font-medium text-ink">Open tasks</p>
          {data.tasks.length === 0 ? <p className="text-sm text-muted">Nothing open.</p> : (
            <div className="space-y-3">
              {data.tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                  <div>
                    <p className="text-ink">{t.title}</p>
                    <p className="text-xs text-muted">{name(t.borrowers)}{t.due_date ? ` · due ${t.due_date}` : ''}</p>
                  </div>
                  <button onClick={() => completeTask(t.id)} className="shrink-0 rounded-control border border-line px-3 py-1 text-xs text-ink hover:border-ink/30">Done</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-4 text-sm font-medium text-ink">Later this week</p>
          {data.upcomingCalls.length === 0 ? <p className="text-sm text-muted">Nothing else booked this week.</p> : (
            <div className="space-y-3">
              {data.upcomingCalls.map((c) => (
                <Link key={c.id} href={`/caseload/${c.borrower_id}`} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                  <span className="text-ink">{name(c.borrowers)}</span>
                  <span className="text-muted">{new Date(c.scheduled_at).toLocaleString()}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-4 text-sm font-medium text-ink">Unread messages</p>
          {data.unreadMessages.length === 0 && data.unreadTexts.length === 0 ? <p className="text-sm text-muted">All caught up.</p> : (
            <div className="space-y-3">
              {data.unreadMessages.map((m) => (
                <Link key={m.id} href={`/caseload/${m.borrower_id}`} className="block border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                  <p className="text-ink">{name(m.borrowers)} <span className="text-xs text-muted">· portal</span></p>
                  <p className="mt-0.5 truncate text-muted">{m.body}</p>
                </Link>
              ))}
              {data.unreadTexts.map((m) => (
                <Link key={m.id} href={`/caseload/${m.borrower_id}`} className="block border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                  <p className="text-ink">{name(m.borrowers)} <span className="text-xs text-muted">· text</span></p>
                  <p className="mt-0.5 truncate text-muted">{m.body}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-4 text-sm font-medium text-ink">Needs review</p>
          {data.openComplaints.length === 0 && data.paymentFailures.length === 0 ? (
            <p className="text-sm text-muted">Nothing flagged.</p>
          ) : (
            <div className="space-y-3">
              {data.openComplaints.map((c) => (
                <Link key={c.id} href="/compliance/complaints" className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                  <span className="text-ink">{name(c.borrowers)} · {c.category.replace('_', ' ')} complaint</span>
                  <span className="rounded-full bg-terra-tint px-2 py-0.5 text-xs text-terra">{c.status.replace('_', ' ')}</span>
                </Link>
              ))}
              {data.paymentFailures.map((p) => (
                <Link key={p.id} href={`/caseload/${p.borrower_id}`} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                  <span className="flex items-center gap-1.5 text-ink"><CreditCard size={13} strokeWidth={1.75} /> {name(p.borrowers)} · payment failed</span>
                  <span className="text-muted">{p.payment_retry_count} attempt{p.payment_retry_count === 1 ? '' : 's'}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

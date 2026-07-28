'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { CheckSquare, Phone, MessageCircle, AlertTriangle, CreditCard, Sparkles } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';

interface BorrowerRef { first_name: string; last_name: string }
interface TaskItem { id: string; type: string | null; title: string; due_date: string | null; borrower_id: string | null; borrowers: BorrowerRef | null }
interface CallItem { id: string; scheduled_at: string; borrower_id: string; borrowers: BorrowerRef | null }
interface MessageItem { id: string; borrower_id: string; body: string; created_at: string; borrowers: BorrowerRef | null }
interface ComplaintItem { id: string; borrower_id: string; category: string; status: string; opened_at: string; borrowers: BorrowerRef | null }
interface PaymentItem { id: string; borrower_id: string; last_payment_failed_at: string; payment_retry_count: number; borrowers: BorrowerRef | null }

interface Today {
  tasks: TaskItem[];
  upcomingCalls: CallItem[];
  unreadMessages: MessageItem[];
  openComplaints: ComplaintItem[];
  paymentFailures: PaymentItem[];
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
    await fetch('/api/coach/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, completed: true }),
    });
    load();
  }

  const needsAttention = useMemo(() => {
    if (!data) return 0;
    return data.tasks.length + data.unreadMessages.length + data.openComplaints.length + data.paymentFailures.length;
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
      <div className="mb-8 overflow-hidden rounded-card bg-gradient-dark p-8 text-white shadow-elevated">
        <p className="text-[13px] text-white/50">Today</p>
        <h1 className="mt-1 text-[32px] font-medium leading-tight">
          {needsAttention === 0 ? "You're all caught up" : `${needsAttention} thing${needsAttention === 1 ? '' : 's'} need your attention`}
        </h1>
        <p className="mt-3 flex items-start gap-2 text-sm text-white/70">
          <Sparkles size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>{briefingLoading ? 'Writing your briefing…' : (briefing ?? 'Everything below is pulled live.')}</span>
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Open tasks" value={data.tasks.length} accent={data.tasks.length > 0 ? 'iris' : undefined} icon={<CheckSquare size={16} strokeWidth={1.75} />} />
        <StatCard label="Calls this week" value={data.upcomingCalls.length} icon={<Phone size={16} strokeWidth={1.75} />} />
        <StatCard label="Unread messages" value={data.unreadMessages.length} accent={data.unreadMessages.length > 0 ? 'gold' : undefined} icon={<MessageCircle size={16} strokeWidth={1.75} />} />
        <StatCard label="Needs review" value={data.openComplaints.length + data.paymentFailures.length} accent={(data.openComplaints.length + data.paymentFailures.length) > 0 ? 'money' : undefined} icon={<AlertTriangle size={16} strokeWidth={1.75} />} />
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
          <p className="mb-4 text-sm font-medium text-ink">Upcoming calls</p>
          {data.upcomingCalls.length === 0 ? <p className="text-sm text-muted">Nothing booked this week.</p> : (
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
          {data.unreadMessages.length === 0 ? <p className="text-sm text-muted">All caught up.</p> : (
            <div className="space-y-3">
              {data.unreadMessages.map((m) => (
                <Link key={m.id} href={`/caseload/${m.borrower_id}`} className="block border-b border-line pb-3 text-sm last:border-0 last:pb-0 hover:text-money">
                  <p className="text-ink">{name(m.borrowers)}</p>
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

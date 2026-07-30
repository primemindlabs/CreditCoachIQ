'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

interface TodayData {
  tasks: { id: string; type: string; title: string; due_date: string | null; borrower_id: string | null; borrowers: { first_name: string; last_name: string } | null }[];
  unreadMessages: { id: string; borrower_id: string; body: string; borrowers: { first_name: string; last_name: string } | null }[];
  unreadTexts: { id: string; borrower_id: string; body: string; borrowers: { first_name: string; last_name: string } | null }[];
  openComplaints: { id: string; borrower_id: string; category: string; borrowers: { first_name: string; last_name: string } | null }[];
  paymentFailures: { id: string; borrower_id: string; borrowers: { first_name: string; last_name: string } | null }[];
}

interface NotificationItem {
  id: string;
  label: string;
  href: string;
  kind: 'task' | 'message' | 'text' | 'complaint' | 'payment';
}

const KIND_STYLE: Record<string, string> = {
  task: 'bg-line text-muted',
  message: 'bg-iris-tint text-iris',
  text: 'bg-iris-tint text-iris',
  complaint: 'bg-terra-tint text-terra',
  payment: 'bg-terra-tint text-terra',
};
const KIND_LABEL: Record<string, string> = { task: 'Task', message: 'Message', text: 'Text', complaint: 'Complaint', payment: 'Payment' };

/**
 * Reuses /api/coach/today (already built for the Today page) rather than a
 * second parallel aggregation endpoint, so this and the Today page can never
 * silently drift out of sync on what counts as "needs attention." Polls
 * every 60s while mounted, since this lives in the persistent nav.
 */
export default function NotificationBell() {
  const [data, setData] = useState<TodayData | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/today');
      if (res.ok) setData(await res.json());
    } catch {
      // Non-critical — bell just shows stale/no count until the next poll.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const name = (b: { first_name: string; last_name: string } | null) => (b ? `${b.first_name} ${b.last_name}` : 'A client');
  const now = new Date();

  const items: NotificationItem[] = data
    ? [
        ...data.tasks
          .filter((t) => !t.due_date || new Date(t.due_date) <= now)
          .map((t) => ({ id: `task-${t.id}`, label: `${t.title}${t.borrowers ? `, ${name(t.borrowers)}` : ''}`, href: t.borrower_id ? `/caseload/${t.borrower_id}` : '/today', kind: 'task' as const })),
        ...data.paymentFailures.map((p) => ({ id: `pay-${p.id}`, label: `Payment failed, ${name(p.borrowers)}`, href: `/caseload/${p.borrower_id}`, kind: 'payment' as const })),
        ...data.openComplaints.map((c) => ({ id: `comp-${c.id}`, label: `Open complaint, ${name(c.borrowers)}`, href: `/compliance/complaints`, kind: 'complaint' as const })),
        ...data.unreadMessages.map((m) => ({ id: `msg-${m.id}`, label: `${name(m.borrowers)}: ${m.body.slice(0, 60)}`, href: `/caseload/${m.borrower_id}`, kind: 'message' as const })),
        ...data.unreadTexts.map((s) => ({ id: `sms-${s.id}`, label: `${name(s.borrowers)}: ${s.body.slice(0, 60)}`, href: `/caseload/${s.borrower_id}`, kind: 'text' as const })),
      ]
    : [];

  const count = items.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-control p-1.5 text-muted hover:bg-line/60 hover:text-ink"
        aria-label="Notifications"
      >
        <Bell size={17} strokeWidth={1.75} />
        {count > 0 && (
          <span className="figure absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-terra px-1 text-[10px] font-medium text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-card border border-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-medium text-ink">Needs attention</p>
            <Link href="/today" onClick={() => setOpen(false)} className="text-xs text-money hover:underline">View Today</Link>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nothing needs attention right now.</p>
            ) : (
              items.slice(0, 20).map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2 border-b border-line px-4 py-2.5 text-sm last:border-0 hover:bg-paper"
                >
                  <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLE[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
                  <span className="text-ink">{item.label}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

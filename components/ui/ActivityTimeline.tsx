'use client';

import { Phone, MessageSquare, StickyNote, ArrowRightLeft, Mail, Tag } from 'lucide-react';

interface ActivityItem {
  id: string;
  type: 'stage_change' | 'note' | 'call' | 'sms' | 'email' | 'portal_message' | 'status_change';
  label: string;
  detail: string | null;
  actor: string | null;
  createdAt: string;
}

const ICON: Record<ActivityItem['type'], typeof Phone> = {
  stage_change: ArrowRightLeft,
  note: StickyNote,
  call: Phone,
  sms: MessageSquare,
  email: Mail,
  portal_message: MessageSquare,
  status_change: Tag,
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ActivityTimeline({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  if (items.length === 0) {
    return <p className="text-sm text-muted">No activity yet. Calls, notes, and stage changes will show up here.</p>;
  }

  return (
    <div className="space-y-0">
      {items.map((item, i) => {
        const Icon = ICON[item.type];
        return (
          <div key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[15px] top-8 h-full w-px bg-line" aria-hidden />}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-muted">
              <Icon size={14} strokeWidth={1.75} />
            </span>
            <div className="flex-1 pt-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-ink">{item.label}</p>
                <span className="figure shrink-0 text-[11px] text-muted">{relativeTime(item.createdAt)}</span>
              </div>
              {item.detail && <p className="mt-0.5 text-sm text-muted">{item.detail}</p>}
              {item.actor && <p className="mt-0.5 text-[11px] text-muted">{item.actor}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

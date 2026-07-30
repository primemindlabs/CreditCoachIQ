import type { ReactNode } from 'react';
import Link from 'next/link';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  sub?: string;
  action?: { label: string; href: string };
  accent?: 'money' | 'iris' | 'gold';
  compact?: boolean;
}

const ACCENT_TINT: Record<'money' | 'iris' | 'gold', string> = {
  money: 'bg-money-tint text-money',
  iris: 'bg-iris-tint text-iris',
  gold: 'bg-gold-tint text-gold',
};

/**
 * Replaces bare "Nothing here" one-liners with an icon + title + optional
 * CTA. Still flat/bordered, still light — an accent-tint circle around the
 * icon (same tint tokens StatCard already uses) rather than an illustration,
 * so an empty section reads as "designed for this state" instead of
 * "nothing rendered."
 */
export default function EmptyState({ icon, title, sub, action, accent = 'money', compact }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-10'}`}>
      <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-full ${ACCENT_TINT[accent]}`}>
        {icon}
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {sub && <p className="mt-1 max-w-xs text-[13px] text-muted">{sub}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-4 rounded-control border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-ink/30"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

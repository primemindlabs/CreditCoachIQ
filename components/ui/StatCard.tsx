import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'money' | 'iris' | 'gold' | 'dark';
  icon?: ReactNode;
}

// v4: flat bordered tile, mono tabular value, accent expressed as a 2px
// left rule instead of a gradient fill — see DESIGN_DIRECTION.md v4
// addendum. "dark" accent (previously a filled near-black tile) is folded
// into the plain case since there's no longer a filled-dark variant; it's
// kept in the prop type so existing call sites don't need to change.
const ACCENT_RULE: Record<'money' | 'iris' | 'gold', string> = {
  money: 'border-l-money',
  iris: 'border-l-iris',
  gold: 'border-l-gold',
};

export default function StatCard({ label, value, sub, accent, icon }: StatCardProps) {
  const rule = accent && accent !== 'dark' ? ACCENT_RULE[accent] : 'border-l-line';

  return (
    <div className={`rounded-card border border-line border-l-2 ${rule} bg-white p-5 shadow-card`}>
      <div className="flex items-start justify-between">
        <p className="text-[12px] uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className="figure mt-2 text-[26px] font-medium leading-none text-ink">{value}</p>
      {sub && <p className="mt-2 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

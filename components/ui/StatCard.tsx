import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'money' | 'iris' | 'gold' | 'dark';
  icon?: ReactNode;
}

const FILLED_CLASSES: Record<'money' | 'iris' | 'dark', string> = {
  money: 'bg-gradient-money text-white shadow-glow-money',
  iris: 'bg-gradient-iris text-white shadow-glow-iris',
  dark: 'bg-gradient-dark text-white shadow-elevated',
};

/** Gradient-accented stat tile — the richer-fintech alternative to a plain bordered card. */
export default function StatCard({ label, value, sub, accent, icon }: StatCardProps) {
  if (accent === 'gold') {
    return (
      <div className="rounded-card bg-gold-tint p-6">
        <div className="flex items-start justify-between">
          <p className="text-[13px] text-ink/60">{label}</p>
          {icon && <span className="text-ink/50">{icon}</span>}
        </div>
        <p className="mt-2 text-[30px] font-medium leading-none text-ink">{value}</p>
        {sub && <p className="mt-2 text-[13px] text-ink/60">{sub}</p>}
      </div>
    );
  }

  if (accent) {
    return (
      <div className={`rounded-card p-6 ${FILLED_CLASSES[accent]}`}>
        <div className="flex items-start justify-between">
          <p className="text-[13px] text-white/70">{label}</p>
          {icon && <span className="text-white/70">{icon}</span>}
        </div>
        <p className="mt-2 text-[30px] font-medium leading-none">{value}</p>
        {sub && <p className="mt-2 text-[13px] text-white/70">{sub}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-white p-6 shadow-card">
      <div className="flex items-start justify-between">
        <p className="text-[13px] text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className="mt-2 text-[30px] font-medium leading-none text-ink">{value}</p>
      {sub && <p className="mt-2 text-[13px] text-muted">{sub}</p>}
    </div>
  );
}

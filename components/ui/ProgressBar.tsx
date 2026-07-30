interface ProgressBarProps {
  value: number;
  target: number;
  label?: string;
  sub?: string;
  accent?: 'money' | 'iris' | 'gold';
}

const ACCENT: Record<string, string> = { money: 'bg-money', iris: 'bg-iris', gold: 'bg-gold' };

/**
 * Shared linear progress bar, the same visual pattern that was already
 * inline in a few places (clients-by-stage, production goals) now factored
 * out so financial goals and anything else can use it consistently. Caps
 * the fill at 100% visually even if value overshoots target (a paid-off
 * debt goal can go past its target amount, that's a good thing, not a bug).
 */
export default function ProgressBar({ value, target, label, sub, accent = 'money' }: ProgressBarProps) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div>
      {(label || sub) && (
        <div className="mb-1 flex items-center justify-between text-sm">
          {label && <span className="text-ink">{label}</span>}
          {sub && <span className="text-muted">{sub}</span>}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-money' : ACCENT[accent]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

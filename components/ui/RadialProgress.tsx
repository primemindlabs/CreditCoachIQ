interface RadialProgressProps {
  value: number;
  target: number;
  size?: number;
  centerLabel?: string;
  sub?: string;
}

/**
 * Percentage-based radial ring for goal progress (financial goals, debt
 * payoff), distinct from RadialScore which is purpose-built for the 300-850
 * credit score range. This one is just value/target -> 0-100%, so it works
 * for a dollar goal, a count goal, anything with a numeric target.
 */
export default function RadialProgress({ value, target, size = 96, centerLabel, sub }: RadialProgressProps) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const dash = circumference * pct;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#E8E7E3" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={pct >= 1 ? '#0F9D58' : '#6C5CE7'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - dash}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="figure text-[15px] font-medium leading-none text-ink">{centerLabel ?? `${Math.round(pct * 100)}%`}</span>
        {sub && <span className="mt-1 text-[10px] uppercase tracking-wide text-muted">{sub}</span>}
      </div>
    </div>
  );
}

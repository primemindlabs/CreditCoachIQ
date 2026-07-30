interface FunnelStage {
  label: string;
  count: number;
}

/**
 * Pipeline funnel, plain HTML/CSS bars sized relative to the largest stage
 * (not a trapezoid SVG shape, that reads fine at a glance but a same-width
 * bar with a visible fill percentage is easier to scan for exact counts,
 * which matters more here than the funnel look). Shows conversion from one
 * stage to the next as a small percentage between bars.
 */
export default function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const pct = max > 0 ? Math.round((s.count / max) * 100) : 0;
        const prev = i > 0 ? stages[i - 1] : null;
        const conversionFromPrev = prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null;
        return (
          <div key={s.label}>
            {conversionFromPrev != null && (
              <p className="mb-1 text-[11px] text-muted">{conversionFromPrev}% of {prev!.label.toLowerCase()}</p>
            )}
            <div className="flex items-center gap-3">
              <div className="h-8 flex-1 overflow-hidden rounded-control bg-line">
                <div
                  className="flex h-full items-center rounded-control bg-money px-3 text-xs font-medium text-white transition-all"
                  style={{ width: `${Math.max(pct, s.count > 0 ? 8 : 0)}%` }}
                >
                  {pct > 20 && s.label}
                </div>
              </div>
              <div className="w-28 shrink-0 text-right">
                <span className="figure text-sm font-medium text-ink">{s.count}</span>
                {pct <= 20 && <span className="ml-1.5 text-xs text-muted">{s.label}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

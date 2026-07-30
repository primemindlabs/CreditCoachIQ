interface BarChartProps {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
}

/**
 * Minimal monthly bar chart, same no-charting-library pattern as Sparkline:
 * plain SVG, no recharts/Chart.js dependency (none is installed, and this
 * keeps it that way). Renders nothing meaningful when every value is 0 -
 * still draws the axis so the empty state is visually honest rather than
 * a blank box.
 */
export default function BarChart({ labels, values, color = '#0F9D58', height = 120, formatValue }: BarChartProps) {
  const width = Math.max(240, labels.length * 56);
  const max = Math.max(...values, 1);
  const barWidth = (width / labels.length) * 0.5;
  const gap = (width / labels.length) * 0.5;
  const chartHeight = height - 24; // reserve space for month labels

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {values.map((v, i) => {
        const barHeight = max > 0 ? (v / max) * (chartHeight - 8) : 0;
        const x = i * (barWidth + gap) + gap / 2;
        const y = chartHeight - barHeight;
        return (
          <g key={labels[i]}>
            <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, v > 0 ? 2 : 0)} rx={3} fill={color} opacity={i === values.length - 1 ? 1 : 0.55} />
            {v > 0 && (
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="#6E6E73" fontFamily="inherit">
                {formatValue ? formatValue(v) : v}
              </text>
            )}
            <text x={x + barWidth / 2} y={chartHeight + 16} textAnchor="middle" fontSize="10" fill="#6E6E73" fontFamily="inherit">
              {labels[i].slice(5)}
            </text>
          </g>
        );
      })}
      <line x1={0} y1={chartHeight} x2={width} y2={chartHeight} stroke="#E8E7E3" strokeWidth={1} />
    </svg>
  );
}

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

/**
 * Minimal trend line, no charting library dependency. Renders nothing when
 * fewer than 2 real data points are available — a single score with no
 * history isn't a trend, and this app doesn't fabricate data to fill one in.
 */
export default function Sparkline({ values, width = 160, height = 40, color = '#0F9D58' }: SparklineProps) {
  if (!values || values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const toY = (v: number) => height - ((v - min) / range) * (height - 6) - 3;

  const points = values.map((v, i) => `${i * stepX},${toY(v)}`).join(' ');
  const lastX = (values.length - 1) * stepX;
  const lastY = toY(values[values.length - 1]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

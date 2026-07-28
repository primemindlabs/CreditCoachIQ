'use client';

import { useEffect, useState } from 'react';

interface RadialScoreProps {
  score: number | null;
  target?: number | null;
  min?: number;
  max?: number;
  size?: number;
  label?: string;
  dark?: boolean;
}

/**
 * Gradient-stroke progress ring for a credit score, closer to Mercury/Ramp's
 * data-forward cards than a flat number. Animates in on mount. `target`, if
 * given, renders as a small marker on the track — both are always real
 * values passed in by the caller, never fabricated here.
 */
export default function RadialScore({ score, target, min = 300, max = 850, size = 160, label = 'Credit score', dark = false }: RadialScoreProps) {
  const [animated, setAnimated] = useState(0);
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.min(1, Math.max(0, (score - min) / (max - min)));
  const targetPct = target != null ? Math.min(1, Math.max(0, (target - min) / (max - min))) : null;

  useEffect(() => {
    const t = setTimeout(() => setAnimated(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);

  const dash = circumference * animated;
  const gradientId = `radial-score-${dark ? 'dark' : 'light'}`;
  const cx = size / 2;
  const cy = size / 2;

  let markerX: number | null = null;
  let markerY: number | null = null;
  if (targetPct !== null) {
    const theta = targetPct * 2 * Math.PI;
    markerX = cx + radius * Math.cos(theta);
    markerY = cy + radius * Math.sin(theta);
  }

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#16B872" />
            <stop offset="100%" stopColor="#0C7A45" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke={dark ? 'rgba(255,255,255,0.12)' : '#E8E7E3'} strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - dash}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)' }}
        />
        {markerX !== null && markerY !== null && <circle cx={markerX} cy={markerY} r={4} fill="#C9A05C" />}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-[34px] font-medium leading-none ${dark ? 'text-white' : 'text-ink'}`}>{score ?? '—'}</span>
        <span className={`mt-1.5 text-[11px] ${dark ? 'text-white/60' : 'text-muted'}`}>{label}</span>
      </div>
    </div>
  );
}

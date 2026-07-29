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
 * v4: solid-stroke progress ring, not a gradient — a single confident ink
 * (or money-green, once a real target is on track) line, thin, precise.
 * The gradient-stroke version read as decorative; this reads as measured.
 * `target`, if given, renders as a small marker on the track — both are
 * always real values passed in by the caller, never fabricated here.
 */
export default function RadialScore({ score, target, min = 300, max = 850, size = 160, label = 'Credit score', dark = false }: RadialScoreProps) {
  const [animated, setAnimated] = useState(0);
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.min(1, Math.max(0, (score - min) / (max - min)));
  const targetPct = target != null ? Math.min(1, Math.max(0, (target - min) / (max - min))) : null;

  useEffect(() => {
    const t = setTimeout(() => setAnimated(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);

  const dash = circumference * animated;
  const cx = size / 2;
  const cy = size / 2;
  const strokeColor = dark ? '#FFFFFF' : '#0F9D58';

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
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke={dark ? 'rgba(255,255,255,0.14)' : '#E8E7E3'} strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - dash}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)' }}
        />
        {markerX !== null && markerY !== null && <circle cx={markerX} cy={markerY} r={3} fill={dark ? '#FFFFFF' : '#1D1D1F'} />}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`figure text-[32px] font-medium leading-none ${dark ? 'text-white' : 'text-ink'}`}>{score ?? '—'}</span>
        <span className={`mt-1.5 text-[11px] uppercase tracking-wide ${dark ? 'text-white/50' : 'text-muted'}`}>{label}</span>
      </div>
    </div>
  );
}

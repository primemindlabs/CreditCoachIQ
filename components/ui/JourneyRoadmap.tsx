'use client';

import { Check, Pause, X } from 'lucide-react';

// The 4 stages a client actually progresses through, in order. `paused` and
// `exited` are real values of the same `journey_stage` column (single flat
// enum, see migration 0002's CHECK constraint) but they're not points on a
// line — a client can pause from any stage, so they're rendered as a status
// override on top of the roadmap rather than a 5th/6th step in it.
const CORE_STAGES = [
  { value: 'credit_coaching', label: 'Credit coaching' },
  { value: 'credit_stacking', label: 'Credit stacking' },
  { value: 'loan_ready', label: 'Loan ready' },
  { value: 'handed_off', label: 'Handed off' },
] as const;

interface JourneyRoadmapProps {
  stage: string;
  busy: boolean;
  onChange: (stage: string) => void;
}

export default function JourneyRoadmap({ stage, busy, onChange }: JourneyRoadmapProps) {
  const isPaused = stage === 'paused';
  const isExited = stage === 'exited';
  const isOverridden = isPaused || isExited;
  const currentIndex = CORE_STAGES.findIndex((s) => s.value === stage);

  return (
    <div>
      {isOverridden && (
        <div
          className={`mb-5 flex items-center gap-2 rounded-control border px-3.5 py-2.5 text-sm ${
            isPaused ? 'border-gold/40 bg-gold-tint text-ink' : 'border-terra/30 bg-terra-tint text-terra'
          }`}
        >
          {isPaused ? <Pause size={14} strokeWidth={1.75} /> : <X size={14} strokeWidth={1.75} />}
          <span className="font-medium">{isPaused ? 'Paused' : 'Exited'}</span>
          <span className="text-muted">— pick a stage below to resume the roadmap.</span>
        </div>
      )}

      {/* Track + fill are absolutely positioned behind the circles, inset
          12.5% each side — with 4 equal grid columns, that lands exactly on
          the horizontal center of the first and last circle, so the line
          never needs to guess pixel widths from label text length. */}
      <div className="relative">
        <div className="absolute top-4 h-px bg-line" style={{ left: '12.5%', right: '12.5%' }} aria-hidden />
        <div
          className="absolute top-4 h-px bg-money transition-all"
          style={{ left: '12.5%', width: `${(Math.max(currentIndex, 0) / (CORE_STAGES.length - 1)) * 75}%` }}
          aria-hidden
        />
        <div className="relative grid grid-cols-4">
          {CORE_STAGES.map((s, i) => {
            const isCurrent = !isOverridden && i === currentIndex;
            const isDone = !isOverridden && currentIndex > i;
            const isFuture = isOverridden || currentIndex < i;

            return (
              <button
                key={s.value}
                onClick={() => onChange(s.value)}
                disabled={busy || (isCurrent && !isOverridden)}
                className="flex flex-col items-center gap-2 px-1 text-center disabled:cursor-default"
              >
                <span
                  className={`figure flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white text-xs font-medium transition-colors ${
                    isCurrent
                      ? 'border-money bg-money text-white'
                      : isDone
                        ? 'border-money bg-money-tint text-money-hover'
                        : 'border-line text-muted'
                  }`}
                >
                  {isDone ? <Check size={14} strokeWidth={2} /> : i + 1}
                </span>
                <span className={`text-xs ${isCurrent ? 'font-medium text-ink' : isFuture ? 'text-muted' : 'text-ink'}`}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex gap-4 border-t border-line pt-3">
        {!isPaused && (
          <button onClick={() => onChange('paused')} disabled={busy} className="text-xs text-muted hover:text-ink">
            Pause
          </button>
        )}
        {!isExited && (
          <button onClick={() => onChange('exited')} disabled={busy} className="text-xs text-muted hover:text-terra">
            Mark exited
          </button>
        )}
      </div>
    </div>
  );
}

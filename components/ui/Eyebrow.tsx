interface EyebrowProps {
  n?: number;
  label: string;
  accent?: 'money' | 'iris' | 'gold';
}

const ACCENT_TEXT: Record<'money' | 'iris' | 'gold', string> = {
  money: 'text-money',
  iris: 'text-iris',
  gold: 'text-gold',
};

/**
 * Small numbered section label ("01 — CASELOAD"). Adds editorial structure
 * above a page or section heading without any new color/weight beyond what
 * the design system already allows — the number is `.figure` mono in the
 * accent color, the label is the same uppercase/tracked treatment already
 * used for stat labels elsewhere. No gradients, no pill background.
 */
export default function Eyebrow({ n, label, accent = 'money' }: EyebrowProps) {
  return (
    <p className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-muted">
      {n !== undefined && (
        <span className={`figure ${ACCENT_TEXT[accent]}`}>{String(n).padStart(2, '0')}</span>
      )}
      <span>{label}</span>
    </p>
  );
}

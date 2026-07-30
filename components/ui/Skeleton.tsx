export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-control bg-line ${className}`} />;
}

/**
 * Shape-matched loading placeholders, replacing bare "Loading…" text across
 * the app. This is the single biggest gap versus a polished product: a
 * blank page with one line of gray text reads as unfinished even when it's
 * just a normal fetch in flight. Each variant roughly matches the layout of
 * what it's standing in for so there's no layout shift once real data lands.
 */
const COLS: Record<number, string> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6' };

export function SkeletonCards({ count = 3, cols }: { count?: number; cols?: number }) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${COLS[cols ?? count] ?? 'sm:grid-cols-3'}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-white p-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card border border-line bg-white p-4">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

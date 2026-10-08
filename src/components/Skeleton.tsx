/**
 * Loading placeholders (PLAN.md §9 PR-18). Every page here is server-rendered
 * against MySQL, so navigation blocks until the query returns; without a
 * loading.tsx the browser shows the previous page and looks frozen.
 *
 * The shapes deliberately match the real layouts — a skeleton that reflows into
 * something different reads as a glitch rather than as loading.
 */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] ${className}`}
    />
  );
}

export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface-border surface-card overflow-hidden">
          <SkeletonBlock className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-2 p-4">
            <SkeletonBlock className="h-4 w-11/12" />
            <SkeletonBlock className="h-3 w-1/2" />
            <SkeletonBlock className="mt-2 h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="surface-border surface-card flex items-center justify-between p-4">
          <div className="flex w-full flex-col gap-2">
            <SkeletonBlock className="h-4 w-1/3" />
            <SkeletonBlock className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

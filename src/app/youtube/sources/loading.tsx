import { SkeletonBlock, SkeletonRows } from "@/components/Skeleton";

export default function SourcesLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <SkeletonBlock className="h-8 w-72" />
      <SkeletonBlock className="mt-6 h-20 w-full rounded-[var(--radius-md)]" />
      <div className="mt-6">
        <SkeletonRows />
      </div>
    </main>
  );
}

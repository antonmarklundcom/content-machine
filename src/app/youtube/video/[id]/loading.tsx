import { SkeletonBlock } from "@/components/Skeleton";

export default function VideoLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-3">
        <SkeletonBlock className="h-5 w-64" />
        <SkeletonBlock className="h-8 w-full" />
        <SkeletonBlock className="h-4 w-40" />
      </div>
      <div className="flex flex-col gap-6">
        <SkeletonBlock className="h-40 w-full rounded-[var(--radius-md)]" />
        <SkeletonBlock className="h-56 w-full rounded-[var(--radius-md)]" />
      </div>
    </main>
  );
}

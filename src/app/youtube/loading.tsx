import { SkeletonBlock, SkeletonCardGrid } from "@/components/Skeleton";

export default function DigestLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-4">
        <SkeletonBlock className="h-8 w-40" />
        <SkeletonBlock className="h-10 w-full max-w-lg" />
      </div>
      <SkeletonCardGrid />
    </main>
  );
}

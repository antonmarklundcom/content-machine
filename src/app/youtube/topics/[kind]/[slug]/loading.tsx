import { SkeletonBlock, SkeletonRows } from "@/components/Skeleton";

export default function TagLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <SkeletonBlock className="h-8 w-64" />
      <div className="mt-8">
        <SkeletonRows />
      </div>
    </main>
  );
}

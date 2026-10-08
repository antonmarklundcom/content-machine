import { SkeletonBlock, SkeletonRows } from "@/components/Skeleton";

export default function MarksLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <SkeletonBlock className="h-8 w-48" />
      <div className="mt-8">
        <SkeletonRows />
      </div>
    </main>
  );
}

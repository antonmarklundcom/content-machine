import type { Asset } from "@/db/schema";

/**
 * The fetched media of a clip (PLAN.md §6.S17), served owner-only by O10's
 * `/api/media/asset/<id>` (single-range, so the video can seek). Research
 * only: nothing here offers a download for reuse.
 */
export function ClipMediaPlayer({ asset, label }: { asset: Asset; label: string }) {
  const src = `/api/media/asset/${asset.id}`;
  if (asset.kind === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={src}
        aria-label={label}
        className="max-h-[70vh] w-full rounded-[var(--radius-sm)] bg-black"
      />
    );
  }
  if (asset.kind === "audio")
    return <audio controls src={src} aria-label={label} className="w-full" />;
  if (asset.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- owner-only route, not an optimisable public image
      <img
        src={src}
        alt={asset.altText ?? label}
        className="max-h-[70vh] w-auto rounded-[var(--radius-sm)]"
      />
    );
  }
  return (
    <a href={src} className="text-sm text-[var(--color-accent)] underline">
      {label}
    </a>
  );
}

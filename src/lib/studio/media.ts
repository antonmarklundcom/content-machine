import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { isSafeSegment, mediaRoot } from "@/lib/storage/root";

/**
 * The `media/` folder (PLAN.md §1.34): what Claude Code saved from Higgsfield,
 * next to the repo, never in git. The app only reads it — to show thumbnails
 * and serve them to the owner through `/api/media/[...path]`.
 *
 * Every read goes through `resolveMediaFile`, which is the whole security
 * boundary: a request path is segments, never a string joined blindly, and the
 * final file's real path (symlinks followed) must still be inside the real
 * media root.
 */

// The root and the path-safety boundary moved to the storage adapter (O10),
// so the script-media routes and the media library share one set of rules.
export { isSafeSegment, mediaRoot, resolveMediaFile } from "@/lib/storage/root";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".json": "application/json",
};

/** The media type to serve a file as; null for anything not an image, a video or a manifest. */
export function mediaContentType(file: string): string | null {
  return TYPES[path.extname(file).toLowerCase()] ?? null;
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/** Where a script's thumbnails are saved, relative to the repo (as `scripts.thumbnail_file` stores it). */
export function thumbnailDir(scriptId: number): string {
  return `media/${scriptId}/thumbnails`;
}

/**
 * The image files in `media/<id>/thumbnails/`, in natural order (`1.png`,
 * `1-2.png`, `2.png`, … `10.png`). Symlinks and anything not an image are
 * left out; a missing folder is an empty list.
 */
export async function listThumbnails(scriptId: number): Promise<string[]> {
  if (!Number.isInteger(scriptId) || scriptId <= 0) return [];
  const dir = path.join(mediaRoot(), String(scriptId), "thumbnails");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of names) {
    if (!IMAGE.test(name) || !isSafeSegment(name)) continue;
    const info = await lstat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) files.push(name);
  }
  // Compared without the extension, so "1.png" (the first variant) sorts before "1-2.png".
  const stem = (name: string) => name.slice(0, name.length - path.extname(name).length);
  return files.sort(
    (a, b) => stem(a).localeCompare(stem(b), "en", { numeric: true }) || a.localeCompare(b),
  );
}

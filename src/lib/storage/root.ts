import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * `MEDIA_ROOT` and the path-safety rules every read and write under it obeys
 * (PLAN.md §1.41). Moved here from `src/lib/studio/media.ts` (build 2), which
 * re-exports them, so the script-media routes and the storage adapter share
 * one security boundary.
 *
 * `MEDIA_ROOT` is meant to be an external drive (e.g. `E:\ContentEngine`).
 * Unset, it is `<repo>/media`, where build 2's Higgsfield commands save.
 */

/** `MEDIA_ROOT` (an external drive, tests), else `<repo>/media`. */
export function mediaRoot(): string {
  return path.resolve(process.env.MEDIA_ROOT || path.join(process.cwd(), "media"));
}

/** One path segment a URL or a relative path may carry: a plain name, nothing that climbs, roots or separates. */
export function isSafeSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  if (/[/\\\0]/.test(segment)) return false;
  if (/^[a-zA-Z]:/.test(segment)) return false; // a Windows drive
  return true;
}

export function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * A stored relative path (`assets.local_path`, always forward slashes) as
 * segments, or null when any segment is unsafe. Backslashes are accepted as
 * separators so a path typed on Windows splits the same way.
 */
export function splitRelative(rel: string): string[] | null {
  const segments = rel.split(/[/\\]+/).filter((s) => s !== "");
  if (!segments.length || !segments.every(isSafeSegment)) return null;
  return segments;
}

/** The forward-slash relative form of an absolute path under `root`, or null when it is outside. */
export function toRelative(root: string, absolute: string): string | null {
  const resolved = path.resolve(absolute);
  if (!inside(root, resolved)) return null;
  return path.relative(root, resolved).split(path.sep).join("/");
}

/**
 * The absolute path of a regular file under the media root, or null — for a
 * bad segment, a path that leaves the root, a symlink (anywhere along the way)
 * that resolves outside it, a directory, or a file that does not exist.
 */
export async function resolveMediaFile(
  segments: string[],
  root: string = mediaRoot(),
): Promise<string | null> {
  if (!segments.length || !segments.every(isSafeSegment)) return null;
  const candidate = path.resolve(root, ...segments);
  if (!inside(root, candidate)) return null;
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!inside(realRoot, realFile)) return null;
    const info = await stat(realFile);
    return info.isFile() ? realFile : null;
  } catch {
    return null;
  }
}

export type MediaRootStatus = "ok" | "missing" | "unwritable";

/**
 * Whether the media drive is there (§1.41): `missing` when the folder does not
 * exist or is not a folder (the drive is unplugged, or the letter moved),
 * `unwritable` when it exists but cannot be written. Both are normal states —
 * the app says "media drive not connected" and keeps working on metadata.
 */
export async function mediaRootStatus(root: string = mediaRoot()): Promise<MediaRootStatus> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) return "missing";
  } catch {
    return "missing";
  }
  try {
    await access(root, constants.W_OK);
    return "ok";
  } catch {
    return "unwritable";
  }
}

/** The one message every surface shows for a root that is not `ok`. */
export function mediaRootMessage(status: MediaRootStatus): string {
  if (status === "missing") return "Media drive not connected — plug it in or check MEDIA_ROOT.";
  if (status === "unwritable") return "Media drive is read-only — check the drive or MEDIA_ROOT.";
  return "Media drive connected.";
}

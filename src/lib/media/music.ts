/**
 * Music beds for renders (build 5 E): audio files under `MEDIA_ROOT/music/`,
 * plus registered audio assets tagged `music`. A choice travels as a path
 * relative to MEDIA_ROOT and is resolved back with `resolveMusicPath`, which
 * refuses anything that climbs out of the root.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { inside, mediaRoot, splitRelative } from "@/lib/storage/root";

import { MUSIC_DB_CHOICES, MUSIC_DB_DEFAULT, MUSIC_DB_MAX, MUSIC_DB_MIN } from "./music-levels";
import { probeDuration } from "./probe";

export const MUSIC_DIR = "music";
export const MUSIC_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"];
export { MUSIC_DB_CHOICES, MUSIC_DB_DEFAULT, MUSIC_DB_MAX, MUSIC_DB_MIN };

export type MusicTrack = {
  /** Relative to MEDIA_ROOT, forward slashes: the value a form submits. */
  path: string;
  name: string;
  durationSec: number | null;
  source: "folder" | "asset";
};

export function isMusicFile(name: string): boolean {
  return MUSIC_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/**
 * A submitted relative path as its absolute form inside `root`, or null for
 * empty input, `..`, absolute paths, drive letters, NUL, or a non-audio name.
 * Pure: it does not touch the disk (the renderer checks existence).
 */
export function resolveMusicPath(rel: string | null | undefined, root: string): string | null {
  if (!rel || typeof rel !== "string") return null;
  const trimmed = rel.trim();
  if (!trimmed || path.isAbsolute(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\"))
    return null;
  const segments = splitRelative(trimmed);
  if (!segments) return null;
  if (!isMusicFile(segments[segments.length - 1])) return null;
  const abs = path.resolve(root, ...segments);
  return inside(path.resolve(root), abs) ? abs : null;
}

/** Clamps a submitted level to −24 … −12 dB; anything unparsable is the default. */
export function parseMusicDb(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return MUSIC_DB_DEFAULT;
  return Math.min(MUSIC_DB_MAX, Math.max(MUSIC_DB_MIN, Math.round(n)));
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) await walk(full, depth + 1, out);
    else if (e.isFile() && isMusicFile(e.name)) out.push(full);
  }
}

/** Audio files under `<root>/music/` (three folders deep), sorted by path, with durations when ffprobe runs. */
export async function listMusicFiles(root: string = mediaRoot()): Promise<MusicTrack[]> {
  const base = path.join(root, MUSIC_DIR);
  try {
    if (!(await stat(base)).isDirectory()) return [];
  } catch {
    return [];
  }
  const files: string[] = [];
  await walk(base, 0, files);
  files.sort();
  return Promise.all(
    files.map(async (abs) => ({
      path: path.relative(root, abs).split(path.sep).join("/"),
      name: path.relative(base, abs).split(path.sep).join("/"),
      durationSec: await probeDuration(abs),
      source: "folder" as const,
    })),
  );
}

/** Folder files plus registered audio assets tagged `music` (deduplicated by path). */
export async function listMusicTracks(root: string = mediaRoot()): Promise<MusicTrack[]> {
  const tracks = await listMusicFiles(root);
  try {
    const { db } = await import("@/db");
    const { assets } = await import("@/db/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    const rows = await db
      .select({ localPath: assets.localPath, durationSec: assets.durationSec })
      .from(assets)
      .where(and(eq(assets.kind, "audio"), sql`JSON_CONTAINS(${assets.tags}, ${JSON.stringify("music")}) = 1`))
      .limit(200);
    const seen = new Set(tracks.map((t) => t.path));
    for (const r of rows) {
      if (!r.localPath || seen.has(r.localPath) || !resolveMusicPath(r.localPath, root)) continue;
      seen.add(r.localPath);
      tracks.push({
        path: r.localPath,
        name: path.posix.basename(r.localPath),
        durationSec: r.durationSec,
        source: "asset",
      });
    }
  } catch {
    // No database (a unit test, a broken connection): folder files only.
  }
  return tracks;
}

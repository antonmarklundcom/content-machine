import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Read-only comparison of a media tree with its restored copy. It hashes file
 * bytes, never writes, never follows links, and reports private areas only as
 * counts. Kept in plain .mjs so it runs on a host without tsx.
 */

export const MARKER_AREAS = ["_private/media-identities", "_private/shared-identities"];
const PRIVATE_FOLDERS = ["voice/_consent", "voice/_references", "voice/_datasets"];
const AREAS = [...MARKER_AREAS, "private", "_originals", "ordinary"];
const MAX_ENTRIES = 2_000_000;

/** Which backup area a relative (forward-slash) path belongs to. */
export function areaOf(rel) {
  const lower = rel.toLowerCase();
  for (const marker of MARKER_AREAS) if (lower.startsWith(`${marker}/`)) return marker;
  if (
    lower === "_private" ||
    lower.startsWith("_private/") ||
    PRIVATE_FOLDERS.some((f) => lower === f || lower.startsWith(`${f}/`))
  )
    return "private";
  if (lower.startsWith("_originals/")) return "_originals";
  return "ordinary";
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Map of relative path → { size, sha } plus any links/special entries found. */
export async function inventory(root) {
  const base = await realpath(root);
  const files = new Map();
  const links = [];
  const walk = async (dir, rel) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) links.push(childRel);
      else if (info.isDirectory()) await walk(full, childRel);
      else if (info.isFile()) {
        if (files.size >= MAX_ENTRIES) throw new Error("Media tree exceeds the safe entry limit.");
        files.set(childRel, { size: info.size, sha: await sha256(full) });
      } else links.push(childRel);
    }
  };
  await walk(base, "");
  return { files, links };
}

/**
 * Compare source and restored trees. Returns per-area counts and, for
 * non-private areas only, a few example paths so the owner knows where to look.
 */
export async function compareMediaTrees(sourceRoot, restoredRoot, { examples = 5 } = {}) {
  const [source, restored] = await Promise.all([inventory(sourceRoot), inventory(restoredRoot)]);
  const areas = Object.fromEntries(
    AREAS.map((a) => [
      a,
      { source: 0, restored: 0, missing: 0, changed: 0, extra: 0, examples: [] },
    ]),
  );
  const note = (area, kind, rel) => {
    areas[area][kind]++;
    if (
      area !== "private" &&
      !MARKER_AREAS.includes(area) &&
      areas[area].examples.length < examples
    )
      areas[area].examples.push(`${kind}: ${rel}`);
  };
  for (const [rel, info] of source.files) {
    const area = areaOf(rel);
    areas[area].source++;
    const copy = restored.files.get(rel);
    if (!copy) note(area, "missing", rel);
    else if (copy.sha !== info.sha || copy.size !== info.size) note(area, "changed", rel);
  }
  for (const rel of restored.files.keys()) {
    const area = areaOf(rel);
    areas[area].restored++;
    if (!source.files.has(rel)) note(area, "extra", rel);
  }
  const problems = [];
  for (const [area, a] of Object.entries(areas))
    if (a.missing || a.changed)
      problems.push(`${area}: ${a.missing} missing, ${a.changed} changed`);
  for (const marker of MARKER_AREAS)
    if (areas[marker].source > 0 && areas[marker].restored === 0)
      problems.push(`${marker}: marker folder absent from the restored copy`);
  if (source.links.length || restored.links.length)
    problems.push(
      `links or special files are not backed up by this check (source ${source.links.length}, restored ${restored.links.length})`,
    );
  return { identical: problems.length === 0, problems, areas };
}

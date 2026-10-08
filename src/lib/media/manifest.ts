import type { AssetSource } from "@/db/schema";

/**
 * The `manifest.json` the Higgsfield commands write next to what they save
 * (PLAN.md §1.45) — read by `scanMediaRoot()`. Pure: parses text, touches no
 * disk. Tolerant by design, because three commands (build 2's
 * `/higgsfield-shots` and `/higgsfield-thumbnails`, S14's `/higgsfield-post`
 * and `/higgsfield-import`) write it:
 *
 *   {
 *     "brandId"?: "guide", "accountId"?: 3, "postId"?: 41, "scriptId"?: 12,
 *     "source"?: "higgsfield",          // default higgsfield
 *     "tags"?: ["residency"],
 *     "<any key>": [                    // shots, thumbnails, files, assets, …
 *       { "file": "media/12/01-x.png",  // relative to MEDIA_ROOT, the repo, or the manifest
 *         "prompt"?, "model"?, "jobId"?, "url"?, "altText"?, "tags"?,
 *         "status"?: "done" | "failed" }
 *     ]
 *   }
 *
 * Every array of objects with a string `file` is a list of entries; entries
 * with `status: "failed"` are skipped.
 */

export type ManifestEntry = {
  file: string;
  prompt: string | null;
  model: string | null;
  /** The Higgsfield job id, else the result URL — `assets.source_ref`. */
  sourceRef: string | null;
  altText: string | null;
  tags: string[];
};

export type Manifest = {
  brandId: string | null;
  accountId: number | null;
  source: AssetSource;
  entries: ManifestEntry[];
};

const SOURCES: readonly AssetSource[] = ["higgsfield", "upload", "capture", "telegram", "import", "camera"];

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
}

/** The parsed manifest, or null when the text is not a JSON object. */
export function parseManifest(text: string): Manifest | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const top = data as Record<string, unknown>;
  const topTags = strings(top.tags);

  const entries: ManifestEntry[] = [];
  for (const value of Object.values(top)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const file = str(e.file);
      if (!file || e.status === "failed") continue;
      entries.push({
        file,
        prompt: str(e.prompt),
        model: str(e.model),
        sourceRef: str(e.jobId) ?? str(e.url),
        altText: str(e.altText) ?? str(e.alt),
        tags: [...topTags, ...strings(e.tags)],
      });
    }
  }

  const accountId = typeof top.accountId === "number" && Number.isInteger(top.accountId) ? top.accountId : null;
  const source = SOURCES.find((s) => s === top.source) ?? "higgsfield";
  return { brandId: str(top.brandId), accountId, source, entries };
}

/**
 * Where an entry's `file` may be, relative to `MEDIA_ROOT`, in order: as
 * written; without build 2's leading `media/` (those paths are relative to the
 * repo, whose `media/` is the default root); next to the manifest.
 */
export function entryCandidates(file: string, manifestDir: string): string[] {
  const clean = file.replace(/\\/g, "/").replace(/^\.\//, "");
  const base = clean.split("/").pop() ?? clean;
  const out = [clean];
  if (clean.startsWith("media/")) out.push(clean.slice("media/".length));
  out.push(manifestDir ? `${manifestDir}/${base}` : base);
  return [...new Set(out)];
}

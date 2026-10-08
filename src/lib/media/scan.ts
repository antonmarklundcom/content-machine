import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { assets, type AssetSource } from "@/db/schema";
import { CAPTURES_DIR, INBOX_DIR, THUMBS_DIR } from "@/lib/storage/paths";
import { mediaRoot, mediaRootMessage, mediaRootStatus, resolveMediaFile, splitRelative } from "@/lib/storage/root";

import { entryCandidates, parseManifest } from "./manifest";
import { assetOriginal, ORIGINALS_DIR } from "./originals";
import { registerFile, type RegisterMeta, type RegisterResult } from "./register";

/**
 * `npm run media:scan` and the library's "Scan" button (PLAN.md §1.45,
 * §5.O10.3): register every `manifest.json` entry, then every loose file,
 * under `MEDIA_ROOT`.
 *
 * Idempotent by sha256. Every source is hashed; stored originals are immutable.
 */

export type ScanResult =
  | {
      status: "ok";
      manifests: number;
      created: number;
      existing: number;
      updated: number;
      /** Not media (text, `desktop.ini`, half-downloaded files), or already known unchanged. */
      skipped: number;
      errors: Array<{ path: string; message: string }>;
      /** Source paths recovered, including existing assets; excludes rejected/partial files. */
      registeredPaths: string[];
    }
  | { status: "missing"; message: string };

const MANIFEST = "manifest.json";
/** Downloads and sync tools in progress; registered on the next scan once they are whole. */
const PARTIAL = /\.(part|crdownload|download|tmp|partial)$|^~\$/i;

/** Every regular file under the root, relative, forward slashes. Symlinks and dot-names are not followed. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === THUMBS_DIR || entry.name === ORIGINALS_DIR) continue;
        await visit(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }
  await visit(root, "");
  return out.sort();
}

/** What a loose file's folder says about where it came from. */
function looseMeta(rel: string): RegisterMeta {
  const parts = rel.split("/");
  if (parts[0] === INBOX_DIR && parts[1] === "higgsfield") return { source: "higgsfield" };
  if (parts[0] === CAPTURES_DIR && /^\d+$/.test(parts[1] ?? "")) {
    return { source: "capture" satisfies AssetSource, sourceRef: `clip:${parts[1]}` };
  }
  return { source: "import" };
}

export type ScanOptions = {
  /** Only this folder (relative to MEDIA_ROOT, forward slashes), e.g. the files a Higgsfield run wrote. */
  folder?: string;
  /** A terminal generation can supply attribution even if its manifest was never saved. */
  meta?: RegisterMeta;
};

export async function scanMediaRoot(options: ScanOptions = {}): Promise<ScanResult> {
  const root = mediaRoot();
  const status = await mediaRootStatus(root);
  if (status === "missing") return { status: "missing", message: mediaRootMessage(status) };

  const result = { manifests: 0, created: 0, existing: 0, updated: 0, skipped: 0 };
  const errors: Array<{ path: string; message: string }> = [];
  const handled = new Set<string>();
  const registeredPaths = new Set<string>();

  const tally = (rel: string, outcome: RegisterResult) => {
    if (outcome.status === "created" || outcome.status === "existing") registeredPaths.add(rel);
    if (outcome.status === "created") result.created++;
    else if (outcome.status === "existing") {
      result.existing++;
      if (outcome.updated) result.updated++;
    } else errors.push({ path: rel, message: outcome.message });
  };

  const folderSegments = options.folder ? splitRelative(options.folder.replace(/^\/+|\/+$/g, "")) : [];
  if (options.folder && !folderSegments) {
    return { status: "missing", message: `Not a folder inside MEDIA_ROOT: ${options.folder}` };
  }
  const prefix = folderSegments?.length ? folderSegments.join("/") : "";
  const files = prefix
    ? (await walk(path.join(root, ...prefix.split("/")))).map((f) => `${prefix}/${f}`)
    : await walk(root);

  // 1. Manifests first, so a file gets its prompt, model and job id on the scan that first sees it.
  for (const rel of files.filter((f) => path.posix.basename(f) === MANIFEST)) {
    handled.add(rel);
    const manifest = parseManifest(await readFile(path.join(root, ...rel.split("/")), "utf8").catch(() => ""));
    if (!manifest) {
      errors.push({ path: rel, message: "Not a JSON manifest." });
      continue;
    }
    result.manifests++;
    const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    for (const entry of manifest.entries) {
      let found: string | null = null;
      for (const candidate of entryCandidates(entry.file, dir)) {
        const segments = splitRelative(candidate);
        if (segments?.some((part) => part.startsWith(".") || PARTIAL.test(part))) continue;
        if (segments && (!prefix || segments.join("/").startsWith(`${prefix}/`)) && (await resolveMediaFile(segments, root))) {
          found = segments.join("/");
          break;
        }
      }
      if (!found) {
        errors.push({ path: rel, message: `Listed file not found: ${entry.file}` });
        continue;
      }
      if (handled.has(found)) continue;
      handled.add(found);
      try {
        tally(
          found,
          await registerFile(found, {
            brandId: manifest.brandId,
            accountId: manifest.accountId,
            source: manifest.source,
            sourceRef: entry.sourceRef,
            prompt: entry.prompt,
            model: entry.model,
            altText: entry.altText,
            tags: entry.tags,
          }),
        );
      } catch (error) {
        errors.push({ path: found, message: (error as Error).message });
      }
    }
  }

  // Upgrade intact legacy paths. Changed/missing legacy originals must not
  // expose replacement bytes under the old approved identity.
  const legacy = await db.select().from(assets).where(isNotNull(assets.localPath));
  for (const row of legacy) {
    if (row.localPath!.startsWith(`${ORIGINALS_DIR}/`)) continue;
    if (prefix && !row.localPath!.startsWith(`${prefix}/`)) continue;
    try {
      const original = await assetOriginal(row, root);
      await db.update(assets).set({
        localPath: original?.rel ?? null,
        ...(original ? {} : {
          status: "rejected" as const,
          publicUrl: null,
          publicExpiresAt: null,
          notes: `${row.notes ?? ""}\nOriginal bytes missing or changed; restore from backup and review again.`.trim(),
        }),
        updatedAt: new Date(),
      }).where(and(eq(assets.id, row.id), eq(assets.localPath, row.localPath!)));
      if (!original) errors.push({ path: row.localPath!, message: "Original bytes changed or missing; the old asset was detached and requires review." });
    } catch (error) {
      errors.push({ path: row.localPath!, message: (error as Error).message });
    }
  }

  for (const rel of files) {
    if (handled.has(rel)) continue;
    const name = path.posix.basename(rel);
    if (PARTIAL.test(name)) {
      result.skipped++;
      continue;
    }
    try {
      const outcome = await registerFile(rel, { ...looseMeta(rel), ...options.meta });
      // A loose file that is not media is not an error, just not the library's.
      if (outcome.status === "rejected" && outcome.reason === "not_media") result.skipped++;
      else tally(rel, outcome);
    } catch (error) {
      errors.push({ path: rel, message: (error as Error).message });
    }
  }

  return { status: "ok", ...result, errors, registeredPaths: [...registeredPaths].sort() };
}

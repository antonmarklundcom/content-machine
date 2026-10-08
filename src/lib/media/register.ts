import { insertIfAbsent, updateReturning } from "@/db/mutations";
import "server-only";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db";
import { assets, type Asset, type AssetSource, type AssetStatus } from "@/db/schema";
import { localDriver } from "@/lib/storage/local";
import { thumbnailPath } from "@/lib/storage/paths";
import {
  mediaRoot,
  mediaRootMessage,
  mediaRootStatus,
  resolveMediaFile,
  splitRelative,
  toRelative,
} from "@/lib/storage/root";

import { probeDuration } from "./probe";
import { preserveOriginal } from "./originals";
export { sha256File } from "./originals";

/**
 * Turning a file under `MEDIA_ROOT` into an `assets` row (PLAN.md §1.41,
 * §5.O10.3). One row per file *content*: the sha256 is the identity, so the
 * same image saved twice — or moved to another folder — is one asset.
 */

export type RegisterMeta = {
  brandId?: string | null;
  accountId?: number | null;
  source?: AssetSource;
  sourceRef?: string | null;
  prompt?: string | null;
  model?: string | null;
  tags?: string[];
  altText?: string | null;
  notes?: string | null;
  status?: AssetStatus;
};

export type RegisterResult =
  | { status: "created"; asset: Asset }
  /** Already in the library; `updated` when this call filled in a moved path or blank metadata. */
  | { status: "existing"; asset: Asset; updated: boolean }
  /** The media drive is not there — a normal state, not an error. */
  | { status: "missing"; message: string }
  /** Not a file under the root, or not a kind of file the library holds. */
  | { status: "rejected"; reason: "not_found" | "not_media"; message: string };

/** Longest side of a thumbnail, px. */
const THUMB_SIZE = 480;

function cleanTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Image size and a webp thumbnail at `_thumbs/…`; nulls when sharp cannot read the image. */
async function imageFacts(
  file: string,
  sha: string,
  root: string,
): Promise<{ width: number | null; height: number | null; thumbPath: string | null }> {
  try {
    const meta = await sharp(file, { animated: false }).metadata();
    // EXIF orientations 5–8 are rotated a quarter turn: report the size as displayed.
    const turned = (meta.orientation ?? 1) >= 5;
    const width = (turned ? meta.height : meta.width) ?? null;
    const height = (turned ? meta.width : meta.height) ?? null;
    const thumbPath = await writeThumbnail(file, sha, root);
    return { width, height, thumbPath };
  } catch {
    return { width: null, height: null, thumbPath: null };
  }
}

async function writeThumbnail(file: string, sha: string, root: string): Promise<string | null> {
  const key = thumbnailPath(sha);
  const driver = localDriver(root);
  const existing = await driver.exists(key);
  if (existing.ok && existing.exists) return key;
  const data = await sharp(file, { animated: false })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  const put = await driver.put(key, data, { overwrite: true });
  return put.ok ? put.key : null;
}

/** The absolute file for `input` (absolute, or relative to the root) and its stored relative path. */
async function locate(
  input: string,
  root: string,
): Promise<{ file: string; rel: string } | { message: string }> {
  const absolute = path.isAbsolute(input) ? input : path.resolve(root, input);
  const rel = toRelative(root, absolute);
  if (!rel) return { message: `Not under MEDIA_ROOT: ${input}` };
  const segments = splitRelative(rel);
  const file = segments ? await resolveMediaFile(segments, root) : null;
  if (!file) return { message: `No such file under MEDIA_ROOT: ${rel}` };
  return { file, rel };
}

/**
 * Register one file (§5.O10.3): sha256, sniffed media type, image size and a
 * thumbnail via sharp, video/audio duration via ffprobe when it is installed.
 *
 * Idempotent by sha256. For a file already in the library it fills in what
 * the row lacks — a new `local_path` when the old one is gone (the file was
 * moved into a post folder), blank prompt/model/brand from a manifest, a
 * missing thumbnail — and never overwrites what is already set.
 */
export async function registerFile(input: string, meta: RegisterMeta = {}): Promise<RegisterResult> {
  const root = mediaRoot();
  const rootStatus = await mediaRootStatus(root);
  if (rootStatus === "missing") return { status: "missing", message: mediaRootMessage(rootStatus) };

  const located = await locate(input, root);
  if ("message" in located) return { status: "rejected", reason: "not_found", message: located.message };
  const original = await preserveOriginal(located.file, root);
  const rel = located.rel;
  const sniffed = original?.sniffed;
  if (!sniffed) {
    return { status: "rejected", reason: "not_media", message: `Not an image, video, audio or PDF file: ${rel}` };
  }

  const { file, sha, bytes: size, rel: originalRel } = original!;
  const [found] = await db.select().from(assets).where(eq(assets.sha256, sha)).limit(1);
  if (found) return fillIn(found, originalRel, meta, file, root);

  const facts =
    sniffed.kind === "image"
      ? await imageFacts(file, sha, root)
      : { width: null, height: null, thumbPath: null };
  const durationSec = sniffed.kind === "video" || sniffed.kind === "audio" ? await probeDuration(file) : null;

  const [created] = await insertIfAbsent(db, assets, {
      brandId: meta.brandId ?? null,
      accountId: meta.accountId ?? null,
      kind: sniffed.kind,
      mime: sniffed.mime,
      bytes: size,
      sha256: sha,
      width: facts.width,
      height: facts.height,
      durationSec,
      localPath: originalRel,
      thumbPath: facts.thumbPath,
      source: meta.source ?? "import",
      sourceRef: meta.sourceRef ?? null,
      prompt: meta.prompt ?? null,
      model: meta.model ?? null,
      tags: cleanTags(meta.tags),
      status: meta.status ?? "new",
      altText: meta.altText ?? null,
      notes: meta.notes ?? null,
    }, { target: assets.sha256 });
  if (created) return { status: "created", asset: created };

  // Lost a race with another registration of the same content: that row wins.
  const [raced] = await db.select().from(assets).where(eq(assets.sha256, sha)).limit(1);
  return fillIn(raced, originalRel, meta, file, root);
}

async function fillIn(
  row: Asset,
  rel: string,
  meta: RegisterMeta,
  file: string,
  root: string,
): Promise<RegisterResult> {
  const patch: Partial<typeof assets.$inferInsert> = {};

  // Registration always binds an asset to immutable bytes, including legacy rows.
  if (row.localPath !== rel) patch.localPath = rel;
  if (!row.brandId && meta.brandId) patch.brandId = meta.brandId;
  if (row.accountId == null && meta.accountId != null) patch.accountId = meta.accountId;
  if (!row.prompt && meta.prompt) patch.prompt = meta.prompt;
  if (!row.model && meta.model) patch.model = meta.model;
  if (!row.sourceRef && meta.sourceRef) patch.sourceRef = meta.sourceRef;
  if (!row.altText && meta.altText) patch.altText = meta.altText;
  // A manifest says where a loose file came from; "import" is the scanner's don't-know.
  if (row.source === "import" && meta.source && meta.source !== "import") patch.source = meta.source;
  const tags = cleanTags([...row.tags, ...(meta.tags ?? [])]);
  if (tags.length !== row.tags.length) patch.tags = tags;
  if (row.kind === "image") {
    const thumb = row.thumbPath ? splitRelative(row.thumbPath) : null;
    if (!thumb || !(await resolveMediaFile(thumb, root))) {
      const made = await writeThumbnail(file, row.sha256, root).catch(() => null);
      if (made && made !== row.thumbPath) patch.thumbPath = made;
    }
  }

  if (!Object.keys(patch).length) return { status: "existing", asset: row, updated: false };
  const [updated] = await updateReturning(db, assets, { ...patch, updatedAt: new Date() }, eq(assets.id, row.id));
  return { status: "existing", asset: updated, updated: true };
}

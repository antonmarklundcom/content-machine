import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { assets, postAssets, posts, type PostStatus } from "@/db/schema";
import type { StorageDriver } from "@/lib/storage/driver";
import { hostingerConfig, hostingerDriver, hostingerKeyFromUrl, HOSTINGER_NOT_CONFIGURED } from "@/lib/storage/hostinger";
import { localDriver } from "@/lib/storage/local";
import { isPrivateAsset } from "@/lib/media/privacy";
import { mediaRootMessage, mediaRootStatus } from "@/lib/storage/root";

/**
 * The public tier's life cycle (PLAN.md §1.41): `publishCopy` puts an asset on
 * the Hostinger `media.` subdomain so Meta can fetch it (O13), `prunePublic`
 * takes it down again after `MEDIA_PUBLIC_RETENTION_DAYS`.
 */

export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const days = Number.parseInt(env.MEDIA_PUBLIC_RETENTION_DAYS ?? "", 10);
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type PublishResult =
  | { status: "published" | "existing"; url: string; expiresAt: Date }
  /** The endpoint is not configured or the media drive is not connected — normal states. */
  | { status: "missing"; message: string }
  | { status: "not_found"; message: string }
  | { status: "error"; message: string };

type Drivers = { local?: StorageDriver; public?: StorageDriver };

/**
 * A public copy of one asset. An unexpired copy is reused, with its expiry
 * pushed out to a full retention window from `now` — publishing again means
 * the post is live again.
 */
export async function publishCopy(
  assetId: number,
  options: { now?: Date; drivers?: Drivers; writer?: Pick<typeof db, "select" | "update"> } = {},
): Promise<PublishResult> {
  // Sharing the asset row lock with prune prevents renewal/replacement races.
  if (!options.writer) return db.transaction((tx) => publishCopy(assetId, { ...options, writer: tx }));
  const now = options.now ?? new Date();
  const writer = options.writer ?? db;
  const expiresAt = new Date(now.getTime() + retentionDays() * DAY_MS);
  const [asset] = await writer.select().from(assets).where(eq(assets.id, assetId)).limit(1).for("update");
  if (!asset) return { status: "not_found", message: `No asset ${assetId}.` };
  const mediaStatus = await mediaRootStatus();
  if (mediaStatus !== "ok") return { status: "missing", message: mediaRootMessage(mediaStatus) };
  try {
    if (await isPrivateAsset(asset)) return { status: "error", message: "Private or unreviewed media cannot be published. Rescan surviving ordinary sources or review its identity first." };
  } catch {
    return { status: "error", message: "Media privacy classification is unavailable. Restore private media access before publishing." };
  }

  if (asset.publicUrl && asset.publicExpiresAt && asset.publicExpiresAt > now) {
    await writer.update(assets).set({ publicExpiresAt: expiresAt, updatedAt: now }).where(eq(assets.id, assetId));
    return { status: "existing", url: asset.publicUrl, expiresAt };
  }

  const remote = options.drivers?.public ?? (hostingerConfig() ? hostingerDriver() : null);
  if (!remote) return { status: "missing", message: HOSTINGER_NOT_CONFIGURED };
  if (!asset.localPath) return { status: "not_found", message: `Asset ${assetId} has no file on the media drive.` };

  const read = await (options.drivers?.local ?? localDriver()).get(asset.localPath);
  if (!read.ok) {
    return read.reason === "missing"
      ? { status: "missing", message: read.message }
      : { status: read.reason === "not_found" ? "not_found" : "error", message: read.message };
  }

  if (createHash("sha256").update(read.data).digest("hex") !== asset.sha256) {
    return { status: "error", message: "Asset bytes changed. Scan the media library, restore the approved original, and review before publishing." };
  }
  const put = await remote.put(asset.localPath, read.data, { mime: asset.mime, timeoutMs: 30_000 });
  if (!put.ok) return { status: put.reason === "missing" ? "missing" : "error", message: put.message };
  const url = put.url ?? remote.publicUrl?.(put.key);
  if (!url) return { status: "error", message: "The public driver returned no URL." };

  await writer
    .update(assets)
    .set({ publicUrl: url, publicExpiresAt: expiresAt, updatedAt: now })
    .where(eq(assets.id, assetId));
  return { status: "published", url, expiresAt };
}

export type PruneResult =
  | { status: "ok"; removed: number; kept: number; errors: Array<{ assetId: number; message: string }> }
  | { status: "missing"; message: string };

/** A post in one of these still needs its public files, whatever their expiry says. */
const STILL_PUBLISHING: PostStatus[] = ["scheduled", "publishing"];

/**
 * Delete every public copy whose `public_expires_at` has passed (§1.41) and
 * clear the row's link. Copies attached to a post that is still scheduled or
 * publishing are kept. Safe to run daily; a copy the endpoint no longer has
 * is cleared all the same.
 */
export async function prunePublic(options: { now?: Date; driver?: StorageDriver } = {}): Promise<PruneResult> {
  const now = options.now ?? new Date();
  const config = hostingerConfig();
  const driver = options.driver ?? (config ? hostingerDriver(config) : null);
  if (!driver) return { status: "missing", message: HOSTINGER_NOT_CONFIGURED };

  const due = await db
    .select({ id: assets.id, publicUrl: assets.publicUrl })
    .from(assets)
    .where(and(isNotNull(assets.publicUrl), lte(assets.publicExpiresAt, now)));
  if (!due.length) return { status: "ok", removed: 0, kept: 0, errors: [] };

  let removed = 0;
  let kept = 0;
  const errors: Array<{ assetId: number; message: string }> = [];
  for (const row of due) {
    try {
      const result = await db.transaction(async (tx) => {
        // Match editorial/publisher lock order: linked posts before their assets.
        // Scheduling cannot change a linked post while its old public copy is removed.
        const linked = await tx.select({ status: posts.status }).from(posts)
          .innerJoin(postAssets, eq(posts.id, postAssets.postId))
          .where(eq(postAssets.assetId, row.id)).orderBy(posts.id).for("update");
        if (linked.some((p) => STILL_PUBLISHING.includes(p.status))) return "kept";
        const [current] = await tx.select().from(assets).where(eq(assets.id, row.id)).for("update");
        if (!current?.publicUrl || !current.publicExpiresAt || current.publicExpiresAt > now) return "kept";
        const key = config ? hostingerKeyFromUrl(current.publicUrl, config) : urlKey(current.publicUrl);
        if (!key) throw new Error("The selected public URL does not belong to this storage endpoint.");
        const outcome = await driver.remove(key);
        if (!outcome.ok) throw new Error(outcome.message);
        await tx.update(assets).set({ publicUrl: null, publicExpiresAt: null, updatedAt: now })
          .where(and(eq(assets.id, current.id), eq(assets.publicUrl, current.publicUrl), eq(assets.publicExpiresAt, current.publicExpiresAt)));
        return "removed";
      });
      if (result === "removed") removed++; else kept++;
    } catch (error) {
      errors.push({ assetId: row.id, message: error instanceof Error ? error.message : "Could not remove public media." });
    }
  }
  return { status: "ok", removed, kept, errors };
}

/** For an injected driver with no env config: the `files/…` tail of the URL. */
function urlKey(url: string): string | null {
  const match = /\/(files\/\d{4}\/\d{2}\/[a-f0-9]{32}\.[a-z0-9]{2,5})$/.exec(url);
  return match ? match[1] : null;
}

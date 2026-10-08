import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { assets, postAssets, posts, type PostStatus } from "@/db/schema";
import type { StorageDriver } from "@/lib/storage/driver";
import { hostingerConfig, hostingerDriver, hostingerKeyFromUrl, HOSTINGER_NOT_CONFIGURED } from "@/lib/storage/hostinger";
import { localDriver } from "@/lib/storage/local";

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
  const now = options.now ?? new Date();
  const writer = options.writer ?? db;
  const expiresAt = new Date(now.getTime() + retentionDays() * DAY_MS);
  const [asset] = await writer.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) return { status: "not_found", message: `No asset ${assetId}.` };

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

  const busy = new Set(
    (
      await db
        .selectDistinct({ assetId: postAssets.assetId })
        .from(postAssets)
        .innerJoin(posts, eq(posts.id, postAssets.postId))
        .where(
          and(
            inArray(
              postAssets.assetId,
              due.map((d) => d.id),
            ),
            inArray(posts.status, STILL_PUBLISHING),
          ),
        )
    ).map((r) => r.assetId),
  );

  let removed = 0;
  let kept = 0;
  const errors: Array<{ assetId: number; message: string }> = [];
  for (const row of due) {
    if (busy.has(row.id)) {
      kept++;
      continue;
    }
    const key = config ? hostingerKeyFromUrl(row.publicUrl!, config) : urlKey(row.publicUrl!);
    if (!key) {
      errors.push({ assetId: row.id, message: `Not one of this endpoint's URLs: ${row.publicUrl}` });
      continue;
    }
    const outcome = await driver.remove(key);
    if (!outcome.ok) {
      errors.push({ assetId: row.id, message: outcome.message });
      continue;
    }
    await db
      .update(assets)
      .set({ publicUrl: null, publicExpiresAt: null, updatedAt: now })
      .where(eq(assets.id, row.id));
    removed++;
  }
  return { status: "ok", removed, kept, errors };
}

/** For an injected driver with no env config: the `files/…` tail of the URL. */
function urlKey(url: string): string | null {
  const match = /\/(files\/\d{4}\/\d{2}\/[a-f0-9]{32}\.[a-z0-9]{2,5})$/.exec(url);
  return match ? match[1] : null;
}

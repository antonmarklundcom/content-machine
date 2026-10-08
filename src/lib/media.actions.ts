"use server";

/**
 * The media library's writes, from the UI (PLAN.md §6.S14): bulk tag, assign,
 * approve/reject/archive, and "Scan now".
 *
 * Every action returns `{ ok, … } | { ok: false, error }` rather than
 * throwing: production strips a thrown action's message. The bridge is reads
 * only (`src/lib/bridge/README.md`), so the row updates live here; the bytes go
 * through O10's storage module and nothing else.
 */

import path from "node:path";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { assets, type Asset, type AssetStatus } from "@/db/schema";
import { getAccount, type AccountWithBrand } from "@/lib/bridge/accounts";
import { getAsset } from "@/lib/bridge/assets";
import { getBrand } from "@/lib/bridge/brands";
import { requireUser } from "@/lib/auth/session";
import { entryCandidates } from "@/lib/media/manifest";
import { scanMediaRoot } from "@/lib/media/scan";
import { localDriver } from "@/lib/storage/local";
import { handleSegment, INBOX_DIR, segment } from "@/lib/storage/paths";
import {
  mediaRootMessage,
  mediaRootStatus,
  resolveMediaFile,
  splitRelative,
} from "@/lib/storage/root";

export type MediaActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Refuses more than this in one submission — a slip of "select all". */
const BULK_LIMIT = 200;
const MAX_TAGS = 20;

export type BulkMediaOp = "tag" | "untag" | "assign" | "approve" | "reject" | "archive" | "restore";

const STATUS_FOR: Partial<Record<BulkMediaOp, AssetStatus>> = {
  approve: "approved",
  reject: "rejected",
  archive: "archived",
  restore: "new",
};

export type BulkMediaInput = {
  ids: number[];
  op: BulkMediaOp;
  /** For tag/untag: free text, lower-cased and deduped. */
  tags?: string[];
  /** For assign: a brand id, or null to send the assets back to unsorted. */
  brandId?: string | null;
  /** For assign: an account of that brand, or null for brand level. */
  accountId?: number | null;
};

export type BulkMediaResult = MediaActionResult<{
  updated: number;
  /** Files moved out of the unsorted inbox into the brand's folders. */
  moved: number;
  /** Per-file move problems; the row change still stands. */
  warnings: string[];
}>;

function cleanIds(ids: unknown): number[] | null {
  if (!Array.isArray(ids)) return null;
  const out = new Set<number>();
  for (const id of ids) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
    out.add(id);
  }
  return [...out];
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((t): t is string => typeof t === "string")
        .flatMap((t) => t.split(","))
        .map((t) => t.trim().replace(/^#/, "").toLowerCase().slice(0, 60))
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);
}

/** `<brand>/<handle|_brand>/<YYYY-MM>/<file>` — §1.41's layout for a file that has no post yet. */
function sortedKey(asset: Asset, brandId: string, handle: string | null, name: string): string {
  const month = asset.createdAt.toISOString().slice(0, 7);
  return [segment(brandId, "_unsorted"), handleSegment(handle), month, name].join("/");
}

/** A file name safe as one segment: the original's stem slugified, its extension kept. */
function fileName(localPath: string, suffix = ""): string {
  const base = path.posix.basename(localPath.replace(/\\/g, "/"));
  const ext = path.posix
    .extname(base)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  const stem = segment(base.slice(0, base.length - path.posix.extname(base).length), "asset");
  return `${stem}${suffix}${ext}`;
}

/**
 * Move an unsorted inbox file into the brand's folders. The row is only
 * repointed once the copy is on disk; a name taken by another file gets the
 * asset id as a suffix.
 */
async function moveOutOfInbox(
  asset: Asset,
  brandId: string,
  handle: string | null,
): Promise<{ ok: true; key: string; warning?: string } | { ok: false; message: string }> {
  const from = asset.localPath!;
  const segments = splitRelative(from);
  if (!segments) return { ok: false, message: `Unsafe media path: ${from}` };
  const driver = localDriver();
  // O10's boundary: a regular file whose real path is inside the root, never a symlink out.
  const absolute = await resolveMediaFile(segments);
  if (!absolute) return { ok: false, message: `No file at ${from}.` };

  let put = await driver.put(sortedKey(asset, brandId, handle, fileName(from)), {
    file: absolute,
  });
  if (!put.ok && put.reason === "rejected" && put.message.startsWith("A file already exists")) {
    put = await driver.put(sortedKey(asset, brandId, handle, fileName(from, `-${asset.id}`)), {
      file: absolute,
    });
  }
  if (!put.ok) return { ok: false, message: put.message };
  await db
    .update(assets)
    .set({ localPath: put.key, updatedAt: new Date() })
    .where(eq(assets.id, asset.id));
  const removed = await driver.remove(from);
  return removed.ok
    ? { ok: true, key: put.key }
    : { ok: true, key: put.key, warning: `copied, but ${from} stays: ${removed.message}` };
}

/**
 * Point the inbox folder's `manifest.json` at the moved files, so the next scan
 * neither reports them as missing nor loses their prompt/model. Best effort:
 * a manifest that is not there or not JSON is left alone.
 */
async function repointManifests(moves: Map<string, string>): Promise<void> {
  const byFolder = new Map<string, Map<string, string>>();
  for (const [from, to] of moves) {
    const dir = path.posix.dirname(from);
    if (!byFolder.has(dir)) byFolder.set(dir, new Map());
    byFolder.get(dir)!.set(from, to);
  }
  const driver = localDriver();
  for (const [dir, folderMoves] of byFolder) {
    const key = `${dir}/manifest.json`;
    const got = await driver.get(key);
    if (!got.ok) continue;
    let data: unknown;
    try {
      data = JSON.parse(got.data.toString("utf8"));
    } catch {
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    let changed = false;
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        if (typeof entry.file !== "string") continue;
        const hit = entryCandidates(entry.file, dir).find((c) => folderMoves.has(c));
        if (!hit) continue;
        entry.file = folderMoves.get(hit);
        changed = true;
      }
    }
    if (changed) {
      await driver.put(key, Buffer.from(`${JSON.stringify(data, null, 2)}\n`), {
        overwrite: true,
      });
    }
  }
}

function isInInbox(localPath: string | null): boolean {
  return !!localPath && localPath.replace(/\\/g, "/").startsWith(`${INBOX_DIR}/`);
}

/**
 * One bulk action over selected assets. Any signed-in user: tagging, sorting
 * and approving are editorial, not spend (§1.20). Assigning a brand to a file
 * still in `_inbox/` also moves it into `<brand>/<handle|_brand>/<YYYY-MM>/`
 * via the storage module; an unplugged drive keeps the row change and says so.
 */
export async function bulkMediaAction(input: BulkMediaInput): Promise<BulkMediaResult> {
  await requireUser();
  // A server action is a public endpoint: every field is checked, not trusted.
  const ids = cleanIds(input?.ids);
  if (!ids || !ids.length) return { ok: false, error: "Select at least one file." };
  if (ids.length > BULK_LIMIT) {
    return { ok: false, error: `At most ${BULK_LIMIT} files at a time.` };
  }
  const op = input.op;
  const status = STATUS_FOR[op];
  const tags = cleanTags(input.tags);

  let brandId: string | null = null;
  let account: AccountWithBrand | null = null;
  if (op === "tag" || op === "untag") {
    if (!tags.length) return { ok: false, error: "Type at least one tag." };
  } else if (op === "assign") {
    const accountId = input.accountId ?? null;
    if (accountId !== null) {
      if (typeof accountId !== "number" || !Number.isSafeInteger(accountId) || accountId <= 0) {
        return { ok: false, error: "That is not an account id." };
      }
      account = await getAccount(accountId);
      if (!account) return { ok: false, error: `No account ${accountId}.` };
    }
    const raw = typeof input.brandId === "string" ? input.brandId.trim() : "";
    brandId = raw || account?.brandId || null;
    if (brandId && !(await getBrand(brandId)))
      return { ok: false, error: `No brand "${brandId}".` };
    if (account && account.brandId !== brandId) {
      return { ok: false, error: `@${account.handle} belongs to another brand.` };
    }
  } else if (!status) {
    return { ok: false, error: `Unknown action "${String(op)}".` };
  }

  const rows = (await Promise.all(ids.map((id) => getAsset(id)))).filter(
    (row): row is Asset => row !== null,
  );
  if (!rows.length) return { ok: false, error: "Those files no longer exist." };

  const warnings: string[] = [];
  let moved = 0;
  const moves = new Map<string, string>();
  const now = new Date();
  const driveStatus = op === "assign" && brandId ? await mediaRootStatus() : "ok";

  if (status) {
    await db
      .update(assets)
      .set({ status, updatedAt: now })
      .where(
        inArray(
          assets.id,
          rows.map((r) => r.id),
        ),
      );
  }
  for (const asset of status ? [] : rows) {
    if (op === "tag" || op === "untag") {
      const next =
        op === "tag"
          ? [...new Set([...asset.tags, ...tags])]
          : asset.tags.filter((t) => !tags.includes(t));
      await db.update(assets).set({ tags: next, updatedAt: now }).where(eq(assets.id, asset.id));
    } else {
      await db
        .update(assets)
        .set({ brandId, accountId: account?.id ?? null, updatedAt: now })
        .where(eq(assets.id, asset.id));
      if (brandId && isInInbox(asset.localPath)) {
        if (driveStatus !== "ok") {
          warnings.push(`#${asset.id}: ${mediaRootMessage(driveStatus)}`);
          continue;
        }
        const result = await moveOutOfInbox(asset, brandId, account?.handle ?? null);
        if (!result.ok) warnings.push(`#${asset.id}: ${result.message}`);
        else {
          moved++;
          moves.set(asset.localPath!.replace(/\\/g, "/"), result.key);
          if (result.warning) warnings.push(`#${asset.id}: ${result.warning}`);
        }
      }
    }
  }

  if (moves.size) await repointManifests(moves);

  revalidatePath("/media");
  revalidatePath("/media/inbox");
  return { ok: true, updated: rows.length, moved, warnings };
}

export type ScanNowResult = MediaActionResult<{
  created: number;
  existing: number;
  updated: number;
  skipped: number;
  errors: number;
}>;

/** "Scan now": register manifests and loose files under `MEDIA_ROOT` (O10's `scanMediaRoot`). */
export async function scanNowAction(): Promise<ScanNowResult> {
  await requireUser();
  const result = await scanMediaRoot();
  if (result.status === "missing") return { ok: false, error: result.message };
  revalidatePath("/media");
  revalidatePath("/media/inbox");
  return {
    ok: true,
    created: result.created,
    existing: result.existing,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.length,
  };
}

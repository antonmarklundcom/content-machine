import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { queryRows } from "@/db/mutations";
import {
  assets,
  postAssets,
  posts,
  type Asset,
  type AssetKind,
  type AssetSource,
  type AssetStatus,
  type PostAssetRole,
  type PostStatus,
} from "@/db/schema";

/**
 * Reads over the media library (PLAN.md §1.41, §2). Rows only — the bytes are
 * O10's storage adapter's business, never this module's.
 */

export const ASSETS_PAGE_SIZE = 60;

export type AssetsQuery = {
  brandId?: string;
  /** Only assets not yet assigned to any brand — the unsorted inbox. */
  unsorted?: boolean;
  accountId?: number;
  status?: AssetStatus;
  source?: AssetSource;
  kind?: AssetKind;
  /** One tag, exact (tags are stored lower-case). */
  tag?: string;
  /** `created_at >= from` */
  from?: Date;
  /** `created_at < to` */
  to?: Date;
  page?: number;
};

export type AssetsPage = { assets: Asset[]; total: number; page: number; totalPages: number };

function assetConditions(query: AssetsQuery) {
  return and(
    query.brandId ? eq(assets.brandId, query.brandId) : undefined,
    query.unsorted ? isNull(assets.brandId) : undefined,
    query.accountId !== undefined ? eq(assets.accountId, query.accountId) : undefined,
    query.status ? eq(assets.status, query.status) : undefined,
    query.source ? eq(assets.source, query.source) : undefined,
    query.kind ? eq(assets.kind, query.kind) : undefined,
    query.tag ? sql`json_contains(${assets.tags}, json_quote(${query.tag}), '$') = 1` : undefined,
    query.from ? gte(assets.createdAt, query.from) : undefined,
    query.to ? lt(assets.createdAt, query.to) : undefined,
  );
}

/** The library grid: newest first, filtered, one page. */
export async function listAssets(query: AssetsQuery = {}): Promise<AssetsPage> {
  const where = assetConditions(query);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(assets)
    .where(where);
  const totalPages = Math.max(1, Math.ceil(Number(total) / ASSETS_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const rows = await db
    .select()
    .from(assets)
    .where(where)
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(ASSETS_PAGE_SIZE)
    .offset((page - 1) * ASSETS_PAGE_SIZE);
  return { assets: rows, total: Number(total), page, totalPages };
}

export async function getAsset(id: number): Promise<Asset | null> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row ?? null;
}

/** The dedupe lookup (§1.41): one row per file content, wherever it sits. */
export async function getAssetBySha256(sha256: string): Promise<Asset | null> {
  const [row] = await db
    .select()
    .from(assets)
    .where(eq(assets.sha256, sha256.toLowerCase()))
    .limit(1);
  return row ?? null;
}

/** Every tag in use with how many assets carry it, most used first — the filter's options. */
export async function listAssetTags(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await queryRows<{ tag: string; count: number }>(
    db,
    sql`
    select t.tag, count(*) as count
    from ${assets}, json_table(${assets.tags}, '$[*]' columns(tag longtext path '$')) as t
    group by t.tag
    order by count desc, t.tag asc
  `,
  );
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

export type AssetUse = {
  postId: number;
  postTitle: string;
  postStatus: PostStatus;
  accountId: number;
  position: number;
  role: PostAssetRole;
};

/** "Used in" on the media detail drawer: the posts an asset is attached to. */
export async function listAssetUses(assetId: number): Promise<AssetUse[]> {
  return db
    .select({
      postId: postAssets.postId,
      postTitle: posts.title,
      postStatus: posts.status,
      accountId: posts.accountId,
      position: postAssets.position,
      role: postAssets.role,
    })
    .from(postAssets)
    .innerJoin(posts, eq(posts.id, postAssets.postId))
    .where(eq(postAssets.assetId, assetId))
    .orderBy(desc(posts.updatedAt), asc(postAssets.position));
}

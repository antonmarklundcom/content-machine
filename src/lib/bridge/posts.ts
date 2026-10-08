import "server-only";
import { and, asc, desc, eq, getTableColumns, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  brands,
  postAssets,
  posts,
  socialAccounts,
  type Asset,
  type Post,
  type PostAsset,
  type PostStatus,
  type SocialPlatform,
} from "@/db/schema";

/**
 * Reads over posts and their ordered assets (PLAN.md §1.40, §2). The body is
 * a `PostDraft` (src/lib/posts/contract.ts); this module hands it over as
 * stored and leaves validating it to the writers.
 */

export const POSTS_PAGE_SIZE = 50;

export type PostsQuery = {
  accountId?: number;
  brandId?: string;
  familyId?: string;
  status?: PostStatus;
  statuses?: PostStatus[];
  /** On the post's date: `published_at`, else `scheduled_for`. Posts with neither are left out when a range is set. */
  from?: Date;
  to?: Date;
  page?: number;
};

/** A post with the account fields every list shows next to it. */
export type PostWithAccount = Post & {
  platform: SocialPlatform | null;
  handle: string | null;
  familyId: string | null;
};

export type PostsPage = {
  posts: PostWithAccount[];
  total: number;
  page: number;
  totalPages: number;
};

const postColumns = {
  ...getTableColumns(posts),
  platform: socialAccounts.platform,
  handle: socialAccounts.handle,
  familyId: brands.familyId,
};

/** The date a post sits on in the calendar. */
const postDate = sql`coalesce(${posts.publishedAt}, ${posts.scheduledFor})`;

function postConditions(query: PostsQuery) {
  const statuses = query.statuses ?? (query.status ? [query.status] : undefined);
  return and(
    query.accountId !== undefined ? eq(posts.accountId, query.accountId) : undefined,
    query.brandId ? eq(posts.brandId, query.brandId) : undefined,
    query.familyId ? eq(brands.familyId, query.familyId) : undefined,
    statuses?.length ? inArray(posts.status, statuses) : undefined,
    query.from ? gte(postDate, query.from) : undefined,
    query.to ? lt(postDate, query.to) : undefined,
  );
}

function fromPosts() {
  return db
    .select(postColumns)
    .from(posts)
    .leftJoin(socialAccounts, eq(socialAccounts.id, posts.accountId))
    .leftJoin(brands, eq(brands.id, posts.brandId));
}

/** The posts list: most recently edited first, one page. */
export async function listPosts(query: PostsQuery = {}): Promise<PostsPage> {
  const where = postConditions(query);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(posts)
    .leftJoin(brands, eq(brands.id, posts.brandId))
    .where(where);
  const totalPages = Math.max(1, Math.ceil(Number(total) / POSTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const rows = await fromPosts()
    .where(where)
    .orderBy(desc(posts.updatedAt), desc(posts.id))
    .limit(POSTS_PAGE_SIZE)
    .offset((page - 1) * POSTS_PAGE_SIZE);
  return { posts: rows, total: Number(total), page, totalPages };
}

/**
 * The calendar: every post dated inside [from, to) — scheduled or published —
 * oldest first, unpaginated (a month of posts is a screenful, not a table).
 */
export async function listCalendarPosts(
  query: Omit<PostsQuery, "page" | "from" | "to"> & { from: Date; to: Date },
): Promise<PostWithAccount[]> {
  return fromPosts()
    .where(postConditions(query))
    .orderBy(asc(sql`${postDate} is null`), asc(postDate), asc(posts.id));
}

export async function getPost(id: number): Promise<PostWithAccount | null> {
  const [row] = await fromPosts().where(eq(posts.id, id)).limit(1);
  return row ?? null;
}

/** A post's family tree (§1.47): the post it was adapted from, and the posts adapted from it. */
export async function listRelatedPosts(id: number): Promise<PostWithAccount[]> {
  const post = await getPost(id);
  if (!post) return [];
  const rootId = post.parentPostId ?? post.id;
  const rows = await fromPosts()
    .where(or(eq(posts.id, rootId), eq(posts.parentPostId, rootId)))
    .orderBy(asc(posts.id));
  return rows.filter((r) => r.id !== id);
}

export type PostAssetWithAsset = PostAsset & { asset: Asset };

/** A post's files in position order. An attachment whose asset row is gone is skipped. */
export async function listPostAssets(postId: number): Promise<PostAssetWithAsset[]> {
  const rows = await db
    .select({ link: postAssets, asset: assets })
    .from(postAssets)
    .innerJoin(assets, eq(assets.id, postAssets.assetId))
    .where(eq(postAssets.postId, postId))
    .orderBy(asc(postAssets.position));
  return rows.map((r) => ({ ...r.link, asset: r.asset }));
}

/** Scheduled posts whose time has come, oldest first — what `publish:due` works through (O13). */
export async function listDuePosts(now: Date = new Date()): Promise<Post[]> {
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.status, "scheduled"), lte(posts.scheduledFor, now)))
    .orderBy(asc(sql`${posts.scheduledFor} is null`), asc(posts.scheduledFor), asc(posts.id));
}

/** Post counts by status inside [from, to) on the post's date — the home cards (S20). */
export async function countPostsByStatus(
  query: Omit<PostsQuery, "page" | "status" | "statuses">,
): Promise<Partial<Record<PostStatus, number>>> {
  const rows = await db
    .select({ status: posts.status, n: sql<number>`count(*)` })
    .from(posts)
    .leftJoin(brands, eq(brands.id, posts.brandId))
    .where(postConditions(query))
    .groupBy(posts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

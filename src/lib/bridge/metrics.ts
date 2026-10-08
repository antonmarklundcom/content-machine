import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMetrics,
  competitorPosts,
  postMetrics,
  socialCompetitors,
  type AccountMetric,
  type CompetitorPost,
  type PostMetric,
  type SocialCompetitor,
  type SocialCompetitorRole,
} from "@/db/schema";

/**
 * Reads over insights (PLAN.md §1.51, §2): append-only post snapshots, daily
 * account rows, and the competitor accounts a brand studies (S21).
 */

/** Every snapshot of one post, oldest first — the growth curve. */
export async function listPostMetrics(postId: number): Promise<PostMetric[]> {
  return db
    .select()
    .from(postMetrics)
    .where(eq(postMetrics.postId, postId))
    .orderBy(asc(postMetrics.capturedAt), asc(postMetrics.id));
}

/** The newest snapshot of each post given; posts with none are absent. */
export async function latestPostMetrics(postIds: number[]): Promise<PostMetric[]> {
  if (postIds.length === 0) return [];
  const rows = await db
    .select()
    .from(postMetrics)
    .where(
      and(
        inArray(postMetrics.postId, postIds),
        sql`${postMetrics.id} = (
        select pm.id from post_metrics pm
        where pm.post_id = ${postMetrics.postId}
        order by pm.captured_at desc, pm.id desc limit 1
      )`,
      ),
    )
    .orderBy(asc(postMetrics.postId));
  return rows;
}

/** One account's daily rows in [from, to] (ISO dates), oldest first. */
export async function listAccountMetrics(
  accountId: number,
  range: { from?: string; to?: string } = {},
): Promise<AccountMetric[]> {
  return db
    .select()
    .from(accountMetrics)
    .where(
      and(
        eq(accountMetrics.accountId, accountId),
        range.from ? gte(accountMetrics.date, range.from) : undefined,
        range.to ? lte(accountMetrics.date, range.to) : undefined,
      ),
    )
    .orderBy(asc(accountMetrics.date));
}

export async function listSocialCompetitors(
  query: { brandId?: string; role?: SocialCompetitorRole } = {},
): Promise<SocialCompetitor[]> {
  return db
    .select()
    .from(socialCompetitors)
    .where(
      and(
        query.brandId ? eq(socialCompetitors.brandId, query.brandId) : undefined,
        query.role ? eq(socialCompetitors.role, query.role) : undefined,
      ),
    )
    .orderBy(asc(socialCompetitors.brandId), asc(socialCompetitors.handle));
}

/** A competitor's stored posts, newest first. */
export async function listCompetitorPosts(
  competitorId: number,
  options: { since?: Date; limit?: number } = {},
): Promise<CompetitorPost[]> {
  return db
    .select()
    .from(competitorPosts)
    .where(
      and(
        eq(competitorPosts.competitorId, competitorId),
        options.since ? gte(competitorPosts.postedAt, options.since) : undefined,
      ),
    )
    .orderBy(
      asc(sql`${competitorPosts.postedAt} is null`),
      desc(competitorPosts.postedAt),
      desc(competitorPosts.id),
    )
    .limit(options.limit ?? 100);
}

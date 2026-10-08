import "server-only";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/db";
import { accountMetrics, brands, postMetrics, posts, socialAccounts } from "@/db/schema";

import {
  aggregateBy,
  followerTrend,
  hookShape,
  latestSnapshots,
  topPosts,
  totals,
  type FollowerTrend,
  type GroupStats,
  type RankedPost,
  type ResultPost,
} from "./aggregate";

/**
 * Reads for `/results` (build 4 §3.G): published posts in a date range with
 * their newest metrics, and each account's follower rows. Read-only.
 */

export type ResultsQuery = { brandId?: string; accountId?: number; from: Date; to: Date };

export type AccountTrend = {
  accountId: number;
  handle: string;
  platform: string;
  trend: FollowerTrend;
};

export type Results = {
  posts: ResultPost[];
  totals: GroupStats;
  byFormat: GroupStats[];
  byAccount: GroupStats[];
  byLanguage: GroupStats[];
  byMechanic: GroupStats[];
  byHook: GroupStats[];
  top: RankedPost[];
  followers: AccountTrend[];
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function loadResults(query: ResultsQuery): Promise<Results> {
  const accountRows = await db
    .select({
      id: socialAccounts.id,
      handle: socialAccounts.handle,
      platform: socialAccounts.platform,
      language: socialAccounts.language,
      brandLanguage: brands.language,
    })
    .from(socialAccounts)
    .leftJoin(brands, eq(brands.id, socialAccounts.brandId))
    .where(
      and(
        query.brandId ? eq(socialAccounts.brandId, query.brandId) : undefined,
        query.accountId ? eq(socialAccounts.id, query.accountId) : undefined,
      ),
    )
    .orderBy(asc(socialAccounts.platform), asc(socialAccounts.handle));
  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const accountIds = [...accounts.keys()];
  if (accountIds.length === 0) return assemble([], []);

  const postRows = await db
    .select({
      id: posts.id,
      accountId: posts.accountId,
      format: posts.format,
      title: posts.title,
      body: posts.body,
      publishedAt: posts.publishedAt,
      permalink: posts.permalink,
    })
    .from(posts)
    .where(
      and(
        inArray(posts.accountId, accountIds),
        eq(posts.status, "published"),
        gte(posts.publishedAt, query.from),
        lte(posts.publishedAt, query.to),
      ),
    )
    .orderBy(desc(posts.publishedAt), desc(posts.id));

  const snapshots = postRows.length
    ? latestSnapshots(
        await db
          .select({
            id: postMetrics.id,
            postId: postMetrics.postId,
            capturedAt: postMetrics.capturedAt,
            reach: postMetrics.reach,
            impressions: postMetrics.impressions,
            plays: postMetrics.plays,
            likes: postMetrics.likes,
            comments: postMetrics.comments,
            saves: postMetrics.saves,
            shares: postMetrics.shares,
            follows: postMetrics.follows,
          })
          .from(postMetrics)
          .where(
            inArray(
              postMetrics.postId,
              postRows.map((p) => p.id),
            ),
          ),
      )
    : new Map();

  const resultPosts: ResultPost[] = postRows.map((p) => {
    const a = accounts.get(p.accountId)!;
    // Read loosely: a body from an older contract version still has a hook.
    const body = (p.body ?? null) as {
      hook?: unknown;
      engagement?: { mechanic?: unknown };
    } | null;
    return {
      id: p.id,
      accountId: p.accountId,
      handle: a.handle,
      platform: a.platform,
      language: a.language ?? a.brandLanguage ?? "en",
      format: p.format,
      title: p.title,
      hook: typeof body?.hook === "string" ? body.hook : "",
      mechanic: typeof body?.engagement?.mechanic === "string" ? body.engagement.mechanic : null,
      publishedAt: p.publishedAt,
      permalink: p.permalink,
      metrics: snapshots.get(p.id) ?? null,
    };
  });

  const metricRows = await db
    .select({
      accountId: accountMetrics.accountId,
      date: accountMetrics.date,
      followers: accountMetrics.followers,
    })
    .from(accountMetrics)
    .where(
      and(
        inArray(accountMetrics.accountId, accountIds),
        gte(accountMetrics.date, isoDay(query.from)),
        lte(accountMetrics.date, isoDay(query.to)),
      ),
    )
    .orderBy(asc(accountMetrics.date));
  const followers: AccountTrend[] = accountRows
    .map((a) => ({
      accountId: a.id,
      handle: a.handle,
      platform: a.platform,
      trend: followerTrend(metricRows.filter((r) => r.accountId === a.id)),
    }))
    .filter((t) => t.trend.points.length > 0);

  return assemble(resultPosts, followers);
}

function assemble(resultPosts: ResultPost[], followers: AccountTrend[]): Results {
  return {
    posts: resultPosts,
    totals: totals(resultPosts),
    byFormat: aggregateBy(resultPosts, (p) => p.format),
    byAccount: aggregateBy(resultPosts, (p) => `${p.platform} @${p.handle}`),
    byLanguage: aggregateBy(resultPosts, (p) => p.language),
    byMechanic: aggregateBy(resultPosts, (p) => p.mechanic ?? "—"),
    byHook: aggregateBy(resultPosts, (p) => hookShape(p.hook)),
    top: topPosts(resultPosts, 10),
    followers,
  };
}

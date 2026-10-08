import { insertIfAbsent } from "@/db/mutations";
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { brands, commentDrafts, posts, socialAccounts, type Integration } from "@/db/schema";
import { GraphClient, graphFetch, MetaGraphError, type GraphFetch } from "@/lib/meta/graph";
import { listMetaIntegrations, setIntegrationStatus, usableToken } from "@/lib/meta/integration";

import { flattenComments, IG_COMMENT_FIELDS, type IgComment } from "./flatten";

/**
 * `npm run comments:sync` (build 4 §3.G): Instagram comments on the recently
 * published posts of every linked professional account, upserted into
 * `comment_drafts` (one row per platform + comment id). The account's own
 * comments and replies are skipped; a comment it already answered arrives as
 * `replied`. Nothing is ever posted back (PLAN-build4 §1.11).
 */

export type CommentSyncOptions = {
  fetch?: GraphFetch;
  now?: Date;
  /** Posts published in the last `days` are read. */
  days?: number;
  /** Most comments read per post. */
  maxPerPost?: number;
  /** Only this account. */
  accountId?: number;
};

export type CommentSyncReport = {
  accounts: number;
  posts: number;
  seen: number;
  inserted: number;
  expired: number[];
  errors: string[];
};

class TokenRejected extends Error {}

async function syncAccount(
  client: GraphClient,
  account: { id: number; handle: string; language: string },
  opts: Required<Omit<CommentSyncOptions, "fetch" | "accountId">>,
  report: CommentSyncReport,
): Promise<void> {
  const since = new Date(opts.now.getTime() - opts.days * 86_400_000);
  const recent = await db
    .select({ id: posts.id, externalMediaId: posts.externalMediaId })
    .from(posts)
    .where(
      and(
        eq(posts.accountId, account.id),
        eq(posts.status, "published"),
        isNotNull(posts.externalMediaId),
        gte(posts.publishedAt, since),
      ),
    )
    .orderBy(desc(posts.publishedAt));

  for (const post of recent) {
    let comments: IgComment[];
    try {
      comments = await client.list<IgComment>(
        `${post.externalMediaId}/comments`,
        { fields: IG_COMMENT_FIELDS, limit: 50 },
        opts.maxPerPost,
      );
    } catch (err) {
      if (err instanceof MetaGraphError && err.isTokenError) throw new TokenRejected(err.message);
      report.errors.push(`@${account.handle} post ${post.id}: ${(err as Error).message}`);
      continue;
    }
    report.posts++;
    const flat = flattenComments(comments, account.handle);
    report.seen += flat.length;
    if (flat.length === 0) continue;

    for (const c of flat) {
      const fresh = await db.transaction(async (tx) => {
        const added = await insertIfAbsent(
          tx,
          commentDrafts,
          {
            accountId: account.id,
            postId: post.id,
            platform: "instagram",
            externalCommentId: c.externalCommentId,
            externalMediaId: post.externalMediaId,
            author: c.author,
            commentText: c.text,
            commentedAt: c.commentedAt,
            language: account.language.slice(0, 8),
            status: c.answered ? "replied" : "new",
          },
          {
            target: [commentDrafts.platform, commentDrafts.externalCommentId],
          },
          { id: commentDrafts.id },
        );
        if (added.length) return true;
        // A draft or review that won the lock is protected by the current
        // status predicate; only untouched comments may adopt edited text.
        await tx
          .update(commentDrafts)
          .set({ commentText: c.text, updatedAt: new Date() })
          .where(
            and(
              eq(commentDrafts.platform, "instagram"),
              eq(commentDrafts.externalCommentId, c.externalCommentId),
              eq(commentDrafts.status, "new"),
              ne(commentDrafts.commentText, c.text),
            ),
          );
        return false;
      });
      if (fresh) report.inserted++;
    }
  }
}

async function syncIntegration(
  row: Integration,
  opts: Required<Omit<CommentSyncOptions, "fetch" | "accountId">> & {
    fetch: GraphFetch;
    accountId?: number;
  },
  report: CommentSyncReport,
): Promise<void> {
  const token = await usableToken(row, opts.now);
  if (!token.ok) {
    report.errors.push(`${row.label}: ${token.reason}`);
    return;
  }
  const client = new GraphClient(token.token, opts.fetch);
  const accounts = await db
    .select({
      id: socialAccounts.id,
      handle: socialAccounts.handle,
      language: sql<string>`coalesce(${socialAccounts.language}, ${brands.language}, 'en')`,
    })
    .from(socialAccounts)
    .leftJoin(brands, eq(brands.id, socialAccounts.brandId))
    .where(
      and(
        eq(socialAccounts.integrationId, row.id),
        eq(socialAccounts.platform, "instagram"),
        eq(socialAccounts.isProfessional, true),
        isNotNull(socialAccounts.externalId),
        opts.accountId ? eq(socialAccounts.id, opts.accountId) : undefined,
      ),
    );

  for (const account of accounts) {
    try {
      await syncAccount(client, account, opts, report);
      report.accounts++;
    } catch (err) {
      if (err instanceof TokenRejected) {
        await setIntegrationStatus(
          row.id,
          "expired",
          `Meta rejected the login: ${err.message}`,
          row.credentialVersion,
        );
        report.expired.push(row.id);
        report.errors.push(`${row.label}: Meta rejected the login — reconnect in Settings.`);
        return;
      }
      report.errors.push(`@${account.handle}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function syncComments(options: CommentSyncOptions = {}): Promise<CommentSyncReport> {
  const opts = {
    fetch: options.fetch ?? graphFetch(),
    now: options.now ?? new Date(),
    days: options.days ?? 14,
    maxPerPost: options.maxPerPost ?? 200,
    accountId: options.accountId,
  };
  const report: CommentSyncReport = {
    accounts: 0,
    posts: 0,
    seen: 0,
    inserted: 0,
    expired: [],
    errors: [],
  };
  for (const row of await listMetaIntegrations()) {
    if (row.status === "disabled") continue;
    await syncIntegration(row, opts, report);
  }
  return report;
}

/** Ids of comments still `new`, oldest first — what "Draft all new" works through. */
export async function newCommentIds(accountIds?: number[], limit = 50): Promise<number[]> {
  const rows = await db
    .select({ id: commentDrafts.id })
    .from(commentDrafts)
    .where(
      and(
        eq(commentDrafts.status, "new"),
        accountIds?.length ? inArray(commentDrafts.accountId, accountIds) : undefined,
      ),
    )
    .orderBy(
      asc(sql`${commentDrafts.commentedAt} is null`),
      commentDrafts.commentedAt,
      commentDrafts.id,
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

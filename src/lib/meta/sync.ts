import { upsertReturning } from "@/db/mutations";
import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  accountMetrics,
  postMetrics,
  posts,
  socialAccounts,
  type Integration,
  type SocialAccount,
} from "@/db/schema";

import { GraphClient, graphFetch, MetaGraphError, type GraphFetch } from "./graph";
import {
  IG_MEDIA_METRICS,
  mapFbPageInsights,
  mapFbPostInsights,
  mapIgAccountInsights,
  mapIgMediaInsights,
  mediaKind,
  normalizePermalink,
  type AccountMetricColumns,
  type FbPost,
  type IgMedia,
  type InsightRow,
  type PostMetricColumns,
} from "./insights";
import { listMetaIntegrations, setIntegrationStatus, usableToken } from "./integration";
import { pageToken } from "./pages";

/**
 * `npm run meta:sync` (PLAN.md §5.O12): for every linked Instagram account and
 * Facebook Page, one `post_metrics` snapshot per known post (matched by
 * `external_media_id`, else by permalink) and one `account_metrics` row for
 * yesterday (UTC). A token Meta rejects marks its integration `expired`; any
 * other failure is reported per account and the rest carry on.
 */

export type SyncOptions = {
  fetch?: GraphFetch;
  now?: Date;
  /** How far back media are looked at. */
  days?: number;
  /** Most media read per account. */
  maxMedia?: number;
};

export type SyncReport = {
  integrations: number;
  accounts: number;
  mediaSeen: number;
  postsMatched: number;
  snapshots: number;
  accountRows: number;
  expired: number[];
  errors: string[];
};

const IG_MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count";
const FB_POST_FIELDS =
  "id,permalink_url,created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
const BASIC_IG_METRICS = ["reach", "likes", "comments", "saved", "shares"];

type KnownPost = { id: number; externalMediaId: string | null; permalink: string | null };

class TokenRejected extends Error {}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function knownPosts(accountId: number): Promise<KnownPost[]> {
  return db
    .select({ id: posts.id, externalMediaId: posts.externalMediaId, permalink: posts.permalink })
    .from(posts)
    .where(eq(posts.accountId, accountId));
}

/** The post a piece of media is, by media id first, then by permalink. */
function matcher(known: KnownPost[]) {
  const byId = new Map(known.filter((p) => p.externalMediaId).map((p) => [p.externalMediaId!, p]));
  const byLink = new Map<string, KnownPost>();
  for (const p of known) {
    const k = normalizePermalink(p.permalink);
    if (k) byLink.set(k, p);
  }
  return (mediaId: string, permalink: string | undefined) => {
    const hit = byId.get(mediaId);
    if (hit) return { post: hit, byPermalink: false };
    const k = normalizePermalink(permalink);
    const viaLink = k ? byLink.get(k) : undefined;
    return viaLink ? { post: viaLink, byPermalink: true } : null;
  };
}

async function snapshot(
  postId: number,
  columns: PostMetricColumns,
  raw: unknown,
  capturedAt: Date,
): Promise<void> {
  await db.insert(postMetrics).values({ postId, capturedAt, ...columns, raw });
}

async function upsertAccountDay(
  accountId: number,
  date: string,
  columns: AccountMetricColumns,
  raw: unknown,
): Promise<void> {
  await upsertReturning(
    db,
    accountMetrics,
    { accountId, date, ...columns, raw },
    {
      target: [accountMetrics.accountId, accountMetrics.date],
      set: {
        followers: columns.followers,
        reach: columns.reach,
        profileVisits: columns.profileVisits,
        raw,
      },
    },
  );
}

/** Rethrow a token failure so the whole integration stops; swallow nothing else here. */
function rethrowToken(err: unknown): never {
  if (err instanceof MetaGraphError && err.isTokenError) throw new TokenRejected(err.message);
  throw err;
}

async function igInsights(client: GraphClient, media: IgMedia): Promise<InsightRow[]> {
  const metrics = IG_MEDIA_METRICS[mediaKind(media)];
  try {
    const r = await client.get<{ data: InsightRow[] }>(`${media.id}/insights`, {
      metric: metrics.join(","),
    });
    return r.data ?? [];
  } catch (err) {
    if (err instanceof MetaGraphError && err.isTokenError) rethrowToken(err);
    // A metric this media does not support fails the whole call: retry with
    // the basic set, then fall back to the counts on the media itself.
    try {
      const r = await client.get<{ data: InsightRow[] }>(`${media.id}/insights`, {
        metric: BASIC_IG_METRICS.join(","),
      });
      return r.data ?? [];
    } catch (err2) {
      if (err2 instanceof MetaGraphError && err2.isTokenError) rethrowToken(err2);
      return [];
    }
  }
}

async function syncInstagram(
  client: GraphClient,
  account: SocialAccount,
  opts: Required<Omit<SyncOptions, "fetch">>,
  report: SyncReport,
): Promise<void> {
  const igId = account.externalId!;
  const since = opts.now.getTime() - opts.days * 86_400_000;
  const media = (
    await client.list<IgMedia>(
      `${igId}/media`,
      { fields: IG_MEDIA_FIELDS, limit: 50 },
      opts.maxMedia,
    )
  ).filter((m) => !m.timestamp || Date.parse(m.timestamp) >= since);
  report.mediaSeen += media.length;

  const match = matcher(await knownPosts(account.id));
  for (const m of media) {
    const hit = match(m.id, m.permalink);
    if (!hit) continue;
    report.postsMatched++;
    if (hit.byPermalink && !hit.post.externalMediaId) {
      await db.update(posts).set({ externalMediaId: m.id }).where(eq(posts.id, hit.post.id));
    }
    const rows = await igInsights(client, m);
    await snapshot(
      hit.post.id,
      mapIgMediaInsights(m, rows),
      { media: m, insights: rows },
      opts.now,
    );
    report.snapshots++;
  }

  const day = new Date(opts.now.getTime() - 86_400_000);
  const dayStart = Math.floor(Date.parse(`${isoDay(day)}T00:00:00Z`) / 1000);
  const profile = await client.get<{ followers_count?: number }>(igId, {
    fields: "followers_count",
  });
  let rows: InsightRow[] = [];
  try {
    const r = await client.get<{ data: InsightRow[] }>(`${igId}/insights`, {
      metric: "reach,profile_views",
      period: "day",
      metric_type: "total_value",
      since: dayStart,
      until: dayStart + 86_400,
    });
    rows = r.data ?? [];
  } catch (err) {
    if (err instanceof MetaGraphError && err.isTokenError) rethrowToken(err);
    report.errors.push(`@${account.handle}: account insights: ${(err as Error).message}`);
  }
  await upsertAccountDay(
    account.id,
    isoDay(day),
    mapIgAccountInsights(profile.followers_count, rows),
    { profile, insights: rows },
  );
  report.accountRows++;
}

async function syncFacebookPage(
  userClient: GraphClient,
  account: SocialAccount,
  opts: Required<Omit<SyncOptions, "fetch">> & { fetch: GraphFetch },
  report: SyncReport,
): Promise<void> {
  const pageId = account.externalId!;
  const client = new GraphClient(await pageToken(userClient, pageId), opts.fetch);
  const since = Math.floor((opts.now.getTime() - opts.days * 86_400_000) / 1000);
  const fbPosts = await client.list<FbPost>(
    `${pageId}/posts`,
    { fields: FB_POST_FIELDS, since, limit: 50 },
    opts.maxMedia,
  );
  report.mediaSeen += fbPosts.length;

  const match = matcher(await knownPosts(account.id));
  for (const p of fbPosts) {
    const hit = match(p.id, p.permalink_url);
    if (!hit) continue;
    report.postsMatched++;
    if (hit.byPermalink && !hit.post.externalMediaId) {
      await db.update(posts).set({ externalMediaId: p.id }).where(eq(posts.id, hit.post.id));
    }
    let rows: InsightRow[] = [];
    try {
      const r = await client.get<{ data: InsightRow[] }>(`${p.id}/insights`, {
        metric: "post_impressions_unique,post_impressions",
      });
      rows = r.data ?? [];
    } catch (err) {
      if (err instanceof MetaGraphError && err.isTokenError) rethrowToken(err);
    }
    await snapshot(hit.post.id, mapFbPostInsights(p, rows), { post: p, insights: rows }, opts.now);
    report.snapshots++;
  }

  const day = new Date(opts.now.getTime() - 86_400_000);
  const dayStart = Math.floor(Date.parse(`${isoDay(day)}T00:00:00Z`) / 1000);
  const page = await client.get<{ followers_count?: number }>(pageId, {
    fields: "followers_count",
  });
  let rows: InsightRow[] = [];
  try {
    const r = await client.get<{ data: InsightRow[] }>(`${pageId}/insights`, {
      metric: "page_impressions_unique",
      period: "day",
      since: dayStart,
      until: dayStart + 86_400,
    });
    rows = r.data ?? [];
  } catch (err) {
    if (err instanceof MetaGraphError && err.isTokenError) rethrowToken(err);
    report.errors.push(`${account.handle}: page insights: ${(err as Error).message}`);
  }
  await upsertAccountDay(account.id, isoDay(day), mapFbPageInsights(page.followers_count, rows), {
    page,
    insights: rows,
  });
  report.accountRows++;
}

async function syncIntegration(
  row: Integration,
  opts: Required<Omit<SyncOptions, "fetch">> & { fetch: GraphFetch },
  report: SyncReport,
): Promise<void> {
  const token = await usableToken(row, opts.now);
  if (!token.ok) {
    if (row.status !== "expired" && /expired/i.test(token.reason)) report.expired.push(row.id);
    report.errors.push(`${row.label}: ${token.reason}`);
    return;
  }
  const client = new GraphClient(token.token, opts.fetch);
  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.integrationId, row.id), isNotNull(socialAccounts.externalId)));

  for (const account of accounts) {
    try {
      if (account.platform === "instagram") await syncInstagram(client, account, opts, report);
      else if (account.platform === "facebook")
        await syncFacebookPage(client, account, opts, report);
      else continue;
      report.accounts++;
    } catch (err) {
      if (err instanceof TokenRejected || (err instanceof MetaGraphError && err.isTokenError)) {
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
  if (row.status === "error") await setIntegrationStatus(row.id, "ok", null, row.credentialVersion);
}

export async function syncMeta(options: SyncOptions = {}): Promise<SyncReport> {
  const opts = {
    fetch: options.fetch ?? graphFetch(),
    now: options.now ?? new Date(),
    days: options.days ?? 90,
    maxMedia: options.maxMedia ?? 100,
  };
  const report: SyncReport = {
    integrations: 0,
    accounts: 0,
    mediaSeen: 0,
    postsMatched: 0,
    snapshots: 0,
    accountRows: 0,
    expired: [],
    errors: [],
  };
  for (const row of await listMetaIntegrations()) {
    if (row.status === "disabled") continue;
    report.integrations++;
    await syncIntegration(row, opts, report);
  }
  return report;
}

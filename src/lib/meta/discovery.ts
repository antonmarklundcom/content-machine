import { upsertReturning } from "@/db/mutations";
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import {
  accountMetrics,
  brands,
  competitorPosts,
  posts,
  socialAccounts,
  socialCompetitors,
  type CompetitorPost,
  type Integration,
  type SocialAccount,
  type SocialCompetitor,
  type SocialCompetitorRole,
} from "@/db/schema";
import { latestPostMetrics } from "@/lib/bridge/metrics";
import { engagementRate } from "@/lib/posts/what-worked";

import { GraphClient, graphFetch, MetaGraphError, type GraphFetch } from "./graph";
import { mediaKind, type IgMedia } from "./insights";
import { listMetaIntegrations, setIntegrationStatus, usableToken } from "./integration";

/**
 * Instagram competitors through Business Discovery (PLAN.md §6.S21): Anton's
 * own linked IG account looks up another account by username and reads its
 * public profile and recent media. Only Business and Creator accounts are
 * visible that way; any other handle is stored as "not available".
 *
 * Posts are ranked against that competitor's own median engagement (likes +
 * comments), the same idea as §1.30: a small account's 3× post beats a big
 * account's ordinary one. The weekly report per own account puts its own
 * posts' metrics next to the best competitor posts and three next-post
 * suggestions built from them (no model call).
 */

export const NOT_AVAILABLE =
  "Not available: Business Discovery only sees Instagram Business or Creator accounts.";

/** Media read per competitor per sync. */
export const DISCOVERY_MEDIA_LIMIT = 25;

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

/** `@Some.Handle` or a profile URL → `some.handle`; null when it cannot be one. */
export function normalizeIgHandle(input: string): string | null {
  let h = input.trim();
  const url = h.match(/instagram\.com\/([^/?#]+)/i);
  if (url) h = url[1];
  h = h.replace(/^@/, "").toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
}

// ---------------------------------------------------------------------------
// Graph call

export type DiscoveryMedia = IgMedia & { view_count?: number };

export type DiscoveryProfile = {
  id: string;
  username?: string;
  name?: string;
  followers_count?: number;
  media_count?: number;
  media?: { data?: DiscoveryMedia[]; paging?: { cursors?: { after?: string } } };
};

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,view_count";

export function discoveryFields(handle: string, limit = DISCOVERY_MEDIA_LIMIT): string {
  return (
    `business_discovery.username(${handle})` +
    `{id,username,name,followers_count,media_count,media.limit(${limit}){${MEDIA_FIELDS}}}`
  );
}

/**
 * Graph answers a handle it cannot discover (personal account, private, or
 * no such user) with code 110 / subcode 2207013. Anything else is a real error.
 */
export function isNotDiscoverable(err: unknown): boolean {
  if (!(err instanceof MetaGraphError) || err.isTokenError) return false;
  return (
    err.code === 110 ||
    err.subcode === 2207013 ||
    /cannot be found|not a business|business or creator/i.test(err.message)
  );
}

export async function discover(
  client: GraphClient,
  viewerIgId: string,
  handle: string,
  limit = DISCOVERY_MEDIA_LIMIT,
): Promise<DiscoveryProfile> {
  const r = await client.get<{ business_discovery?: DiscoveryProfile }>(viewerIgId, {
    fields: discoveryFields(handle, limit),
  });
  if (!r.business_discovery?.id) {
    throw new MetaGraphError(`@${handle} cannot be found.`, 200, 110, 2207013);
  }
  return r.business_discovery;
}

// ---------------------------------------------------------------------------
// Ranking (pure)

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function engagement(p: Pick<CompetitorPost, "likes" | "comments">): number | null {
  if (p.likes === null && p.comments === null) return null;
  return (p.likes ?? 0) + (p.comments ?? 0);
}

export type RankedCompetitorPost = CompetitorPost & {
  handle: string;
  role: SocialCompetitorRole;
  engagement: number;
  median: number;
  /** engagement / that competitor's median; 1 = an ordinary post for them. */
  score: number;
};

/**
 * Score every post against the median of its own competitor's posts (all the
 * posts given for that competitor count towards the median), best first.
 * A post without counts, or a competitor whose median is 0, is not ranked.
 */
export function rankAgainstMedian(
  rows: CompetitorPost[],
  competitors: Pick<SocialCompetitor, "id" | "handle" | "role">[],
): RankedCompetitorPost[] {
  const byCompetitor = new Map<number, CompetitorPost[]>();
  for (const r of rows) {
    const list = byCompetitor.get(r.competitorId) ?? [];
    list.push(r);
    byCompetitor.set(r.competitorId, list);
  }
  const who = new Map(competitors.map((c) => [c.id, c]));
  const out: RankedCompetitorPost[] = [];
  for (const [competitorId, list] of byCompetitor) {
    const c = who.get(competitorId);
    if (!c) continue;
    const scored = list
      .map((p) => ({ p, e: engagement(p) }))
      .filter((x): x is { p: CompetitorPost; e: number } => x.e !== null);
    const m = median(scored.map((x) => x.e));
    if (!m) continue;
    for (const { p, e } of scored) {
      out.push({ ...p, handle: c.handle, role: c.role, engagement: e, median: m, score: e / m });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.engagement - a.engagement);
}

// ---------------------------------------------------------------------------
// Competitor rows

export async function addIgCompetitor(
  brandId: string,
  rawHandle: string,
  role: SocialCompetitorRole = "competitor",
): Promise<{ ok: true; competitor: SocialCompetitor } | { ok: false; error: string }> {
  const handle = normalizeIgHandle(rawHandle);
  if (!handle) return { ok: false, error: "That is not an Instagram username." };
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
  if (!brand) return { ok: false, error: "Unknown brand." };
  const [row] = await upsertReturning(
    db,
    socialCompetitors,
    { brandId, platform: "instagram", handle, role },
    {
      target: [socialCompetitors.brandId, socialCompetitors.platform, socialCompetitors.handle],
      set: { role },
    },
  );
  return { ok: true, competitor: row };
}

/** The competitor and its stored posts go. */
/**
 * The competitor goes. Its stored posts move to another brand's row for the
 * same handle when there is one (media ids are unique across brands), else go.
 */
export async function removeIgCompetitor(id: number): Promise<void> {
  const [row] = await db.select().from(socialCompetitors).where(eq(socialCompetitors.id, id));
  if (!row) return;
  const [other] = await db
    .select({ id: socialCompetitors.id })
    .from(socialCompetitors)
    .where(
      and(
        eq(socialCompetitors.platform, row.platform),
        eq(socialCompetitors.handle, row.handle),
        ne(socialCompetitors.id, id),
      ),
    )
    .limit(1);
  if (other) {
    await db
      .update(competitorPosts)
      .set({ competitorId: other.id })
      .where(eq(competitorPosts.competitorId, id));
  } else {
    await db.delete(competitorPosts).where(eq(competitorPosts.competitorId, id));
  }
  await db.delete(socialCompetitors).where(eq(socialCompetitors.id, id));
}

/**
 * The stored posts of these competitor rows. `competitor_posts.external_id` is
 * unique across brands, so when two brands track the same handle the posts sit
 * under whichever row synced first: read them by handle and hand them back
 * under the given row's id.
 */
async function postsFor(competitors: SocialCompetitor[]): Promise<CompetitorPost[]> {
  if (competitors.length === 0) return [];
  const byHandle = new Map(competitors.map((c) => [c.handle, c.id]));
  const sameHandle = await db
    .select({ id: socialCompetitors.id, handle: socialCompetitors.handle })
    .from(socialCompetitors)
    .where(
      and(
        eq(socialCompetitors.platform, "instagram"),
        inArray(socialCompetitors.handle, [...byHandle.keys()]),
      ),
    );
  const target = new Map(sameHandle.map((r) => [r.id, byHandle.get(r.handle)!]));
  const rows = await db
    .select()
    .from(competitorPosts)
    .where(inArray(competitorPosts.competitorId, [...target.keys()]));
  return rows.map((r) => ({ ...r, competitorId: target.get(r.competitorId)! }));
}

export async function listIgCompetitors(brandId?: string): Promise<SocialCompetitor[]> {
  return db
    .select()
    .from(socialCompetitors)
    .where(
      and(
        eq(socialCompetitors.platform, "instagram"),
        brandId ? eq(socialCompetitors.brandId, brandId) : undefined,
      ),
    )
    .orderBy(
      asc(socialCompetitors.brandId),
      asc(socialCompetitors.role),
      asc(socialCompetitors.handle),
    );
}

// ---------------------------------------------------------------------------
// Sync

export type CompetitorSyncOptions = {
  fetch?: GraphFetch;
  now?: Date;
  brandId?: string;
  limit?: number;
};

export type CompetitorSyncReport = {
  competitors: number;
  synced: number;
  notAvailable: number;
  posts: number;
  errors: string[];
  /** Why nothing ran, when nothing could (no connection, no linked IG account). */
  skipped: string | null;
};

type Viewer = { account: SocialAccount; client: GraphClient; integration: Integration };

/** Linked IG accounts with a usable token; the brand's own first. */
async function viewers(fetchImpl: GraphFetch, now: Date): Promise<Viewer[]> {
  const out: Viewer[] = [];
  for (const row of await listMetaIntegrations()) {
    if (row.status === "disabled" || row.status === "expired") continue;
    const token = await usableToken(row, now);
    if (!token.ok) continue;
    const accounts = await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.integrationId, row.id),
          eq(socialAccounts.platform, "instagram"),
          isNotNull(socialAccounts.externalId),
        ),
      )
      .orderBy(asc(socialAccounts.id));
    const client = new GraphClient(token.token, fetchImpl);
    for (const account of accounts) out.push({ account, client, integration: row });
  }
  return out;
}

async function storePosts(
  competitorId: number,
  media: DiscoveryMedia[],
  now: Date,
): Promise<number> {
  let n = 0;
  for (const m of media) {
    if (!m.id) continue;
    const values = {
      competitorId,
      externalId: m.id,
      permalink: m.permalink?.slice(0, 1024) ?? null,
      caption: m.caption ?? null,
      mediaType:
        (m.media_product_type === "REELS" ? "REEL" : (m.media_type ?? null))?.slice(0, 32) ?? null,
      postedAt: m.timestamp ? new Date(m.timestamp) : null,
      likes: m.like_count ?? null,
      comments: m.comments_count ?? null,
      views: m.view_count ?? null,
      capturedAt: now,
    };
    await upsertReturning(db, competitorPosts, values, {
      target: competitorPosts.externalId,
      set: {
        caption: values.caption,
        likes: values.likes,
        comments: values.comments,
        views: values.views,
        capturedAt: now,
      },
    });
    n++;
  }
  return n;
}

/**
 * Look up every IG competitor (optionally one brand's) and upsert its recent
 * posts. A token Meta rejects marks the integration `expired` and stops.
 */
export async function syncIgCompetitors(
  options: CompetitorSyncOptions = {},
): Promise<CompetitorSyncReport> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetch ?? graphFetch();
  const report: CompetitorSyncReport = {
    competitors: 0,
    synced: 0,
    notAvailable: 0,
    posts: 0,
    errors: [],
    skipped: null,
  };
  const competitors = await listIgCompetitors(options.brandId);
  report.competitors = competitors.length;
  if (competitors.length === 0) {
    report.skipped = "No Instagram competitors yet. Add some on Research → Instagram.";
    return report;
  }
  const available = await viewers(fetchImpl, now);
  if (available.length === 0) {
    report.skipped =
      "No linked Instagram account with a working Meta login. Connect one in Settings → Meta.";
    return report;
  }

  const expired = new Set<number>();
  for (const c of competitors) {
    const viewer =
      available.find((v) => !expired.has(v.integration.id) && v.account.brandId === c.brandId) ??
      available.find((v) => !expired.has(v.integration.id));
    if (!viewer) {
      report.errors.push("Meta rejected the login — reconnect in Settings → Meta.");
      break;
    }
    try {
      const profile = await discover(
        viewer.client,
        viewer.account.externalId!,
        c.handle,
        options.limit,
      );
      report.posts += await storePosts(c.id, profile.media?.data ?? [], now);
      await db
        .update(socialCompetitors)
        .set({
          externalId: profile.id,
          followers: profile.followers_count ?? null,
          lastSyncedAt: now,
          lastError: null,
        })
        .where(eq(socialCompetitors.id, c.id));
      report.synced++;
    } catch (err) {
      if (err instanceof MetaGraphError && err.isTokenError) {
        expired.add(viewer.integration.id);
        await setIntegrationStatus(
          viewer.integration.id,
          "expired",
          `Meta rejected the login: ${err.message}`,
          viewer.integration.credentialVersion,
        );
        report.errors.push(`${viewer.integration.label}: Meta rejected the login — reconnect.`);
        continue;
      }
      const notAvailable = isNotDiscoverable(err);
      if (notAvailable) report.notAvailable++;
      else report.errors.push(`@${c.handle}: ${err instanceof Error ? err.message : String(err)}`);
      await db
        .update(socialCompetitors)
        .set({
          lastSyncedAt: now,
          lastError: (notAvailable ? NOT_AVAILABLE : String((err as Error).message ?? err)).slice(
            0,
            1024,
          ),
        })
        .where(eq(socialCompetitors.id, c.id));
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Reads for the page and the weekly report

/** The brand's IG competitor posts from the last `days`, ranked (§1.30). */
export async function bestCompetitorPosts(
  brandId: string,
  options: { now?: Date; days?: number; limit?: number; role?: SocialCompetitorRole } = {},
): Promise<RankedCompetitorPost[]> {
  const now = options.now ?? new Date();
  const competitors = (await listIgCompetitors(brandId)).filter(
    (c) => !options.role || c.role === options.role,
  );
  if (competitors.length === 0) return [];
  // The median uses every stored post of the competitor; only recent ones are shown.
  const rows = await postsFor(competitors);
  const since = now.getTime() - (options.days ?? 30) * 86_400_000;
  return rankAgainstMedian(rows, competitors)
    .filter((p) => p.postedAt && p.postedAt.getTime() >= since)
    .slice(0, options.limit ?? 10);
}

export type OwnPostRow = {
  id: number;
  title: string;
  format: string;
  permalink: string | null;
  publishedAt: Date | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  rate: number | null;
};

export type Suggestion = { title: string; why: string; permalink: string | null };

export type WeeklyReport = {
  account: SocialAccount;
  from: Date;
  to: Date;
  followers: { start: number | null; end: number | null };
  reach: number | null;
  own: OwnPostRow[];
  best: RankedCompetitorPost[];
  suggestions: Suggestion[];
};

const FORMAT_WORD: Record<string, string> = {
  reel: "reel",
  carousel: "carousel",
  image: "image post",
  video: "video",
  story: "story",
};

function firstLine(text: string | null, max = 90): string {
  const line = (text ?? "").split("\n").find((l) => l.trim()) ?? "";
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function kindOf(mediaType: string | null): string {
  if (mediaType === "REEL") return "reel";
  return mediaKind({ media_type: mediaType ?? undefined });
}

/** Three next-post ideas: the best competitor angles first, then a repeat of our own best. */
export function suggestNextPosts(
  handle: string,
  best: RankedCompetitorPost[],
  own: OwnPostRow[],
): Suggestion[] {
  const out: Suggestion[] = [];
  // One per competitor first, so three ideas are not all from the same account.
  const firstPerHandle = new Map<string, RankedCompetitorPost>();
  for (const p of best) if (!firstPerHandle.has(p.handle)) firstPerHandle.set(p.handle, p);
  const ordered = [...firstPerHandle.values(), ...best];
  const seen = new Set<number>();
  for (const p of ordered) {
    if (out.length >= 3) break;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const format = FORMAT_WORD[kindOf(p.mediaType)] ?? "post";
    const hook = firstLine(p.caption);
    out.push({
      title: `A ${format} for @${handle} on the angle of @${p.handle}${hook ? `: “${hook}”` : ""}`,
      why: `${p.score.toFixed(1)}× @${p.handle}'s usual engagement (${p.engagement} vs a median of ${Math.round(p.median)}). Make it yours; never repost their media.`,
      permalink: p.permalink,
    });
  }
  const bestOwn = [...own].filter((p) => p.rate !== null).sort((a, b) => b.rate! - a.rate!)[0];
  if (out.length < 3 && bestOwn) {
    out.push({
      title: `A follow-up to your best post this week: “${firstLine(bestOwn.title)}”`,
      why: `${(bestOwn.rate! * 100).toFixed(1)}% of reach saved, shared or commented. Same topic, a new hook.`,
      permalink: bestOwn.permalink,
    });
  }
  return out;
}

/** The week ending `now` for one own account. */
export async function weeklyReport(
  accountId: number,
  options: { now?: Date; days?: number } = {},
): Promise<WeeklyReport | null> {
  const to = options.now ?? new Date();
  const from = new Date(to.getTime() - (options.days ?? 7) * 86_400_000);
  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
  if (!account) return null;

  const recent = await db
    .select({
      id: posts.id,
      title: posts.title,
      format: posts.format,
      permalink: posts.permalink,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    .where(and(eq(posts.accountId, accountId), gte(posts.publishedAt, from)))
    .orderBy(desc(posts.publishedAt));
  const metrics = new Map(
    (await latestPostMetrics(recent.map((p) => p.id))).map((m) => [m.postId, m]),
  );
  const own: OwnPostRow[] = recent.map((p) => {
    const m = metrics.get(p.id);
    return {
      ...p,
      reach: m?.reach ?? null,
      likes: m?.likes ?? null,
      comments: m?.comments ?? null,
      saves: m?.saves ?? null,
      shares: m?.shares ?? null,
      rate: m ? engagementRate(m) : null,
    };
  });

  const fromDay = from.toISOString().slice(0, 10);
  const days = await db
    .select({
      date: accountMetrics.date,
      followers: accountMetrics.followers,
      reach: accountMetrics.reach,
    })
    .from(accountMetrics)
    .where(and(eq(accountMetrics.accountId, accountId), gte(accountMetrics.date, fromDay)))
    .orderBy(asc(accountMetrics.date));
  const withFollowers = days.filter((d) => d.followers !== null);
  const reachDays = days.filter((d) => d.reach !== null);

  const best = await bestCompetitorPosts(account.brandId, {
    now: to,
    days: options.days ?? 7,
    limit: 5,
  });
  return {
    account,
    from,
    to,
    followers: {
      start: withFollowers[0]?.followers ?? null,
      end: withFollowers[withFollowers.length - 1]?.followers ?? null,
    },
    reach: reachDays.length ? reachDays.reduce((s, d) => s + d.reach!, 0) : null,
    own,
    best,
    suggestions: suggestNextPosts(account.handle, best, own),
  };
}

/** Own Instagram accounts, for the report picker. */
export async function listIgAccounts(): Promise<SocialAccount[]> {
  return db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.platform, "instagram"))
    .orderBy(asc(socialAccounts.brandId), asc(socialAccounts.handle));
}

/** Stored post counts per competitor row, for the list. */
export async function competitorPostCounts(
  competitors: SocialCompetitor[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const p of await postsFor(competitors)) {
    counts.set(p.competitorId, (counts.get(p.competitorId) ?? 0) + 1);
  }
  return counts;
}

import { deleteReturning, queryRows, upsertReturning } from "@/db/mutations";
import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";

import {
  BRAND_SOURCE_ROLES,
  brandSources,
  type BrandSource,
  type BrandSourceRole,
} from "@/db/schema";
import { OUTLIER_BASELINE_SIZE, OUTLIER_MIN_SAMPLE } from "@/lib/research/outlier";

/**
 * Competitor research (PLAN.md §1.29, §1.30): which channels a brand studies,
 * and which of their videos beat their own channel's median.
 *
 * Writes as well as reads, unlike the older bridge files: lane 2 (§4.7) may
 * touch data only through `src/lib/bridge/`, and linking a channel to a brand
 * is a write S10 needs. Adding a *source* is not here — that stays in the
 * existing source action, which owns ingest.
 */

export class InvalidBrandSourceRoleError extends Error {
  constructor(role: string) {
    super(`Unknown role "${role}". Expected one of: ${BRAND_SOURCE_ROLES.join(", ")}.`);
    this.name = "InvalidBrandSourceRoleError";
  }
}

function assertRole(role: string): asserts role is BrandSourceRole {
  if (!(BRAND_SOURCE_ROLES as readonly string[]).includes(role)) {
    throw new InvalidBrandSourceRoleError(role);
  }
}

/** Link a channel to a brand, or change the role of an existing link; returns the row. */
export async function linkSourceToBrand(
  brandId: string,
  sourceId: number,
  role: BrandSourceRole = "competitor",
): Promise<BrandSource> {
  assertRole(role);
  const [row] = await upsertReturning(
    db,
    brandSources,
    { brandId, sourceId, role },
    { target: [brandSources.brandId, brandSources.sourceId], set: { role } },
  );
  if (!row) throw new Error("Insert into brand_sources returned no row");
  return row;
}

/** Remove a channel from a brand; true if a link existed. The source itself is untouched. */
export async function unlinkSourceFromBrand(brandId: string, sourceId: number): Promise<boolean> {
  const rows = await deleteReturning(
    db,
    brandSources,
    and(eq(brandSources.brandId, brandId), eq(brandSources.sourceId, sourceId)),
    { sourceId: brandSources.sourceId },
  );
  return rows.length > 0;
}

/** Which brands study a channel, and in what role. */
export async function brandsForSource(sourceId: number): Promise<BrandSource[]> {
  return db
    .select()
    .from(brandSources)
    .where(eq(brandSources.sourceId, sourceId))
    .orderBy(asc(brandSources.brandId));
}

/** One linked channel with the figures the research page shows beside it. */
export type BrandCompetitor = {
  sourceId: number;
  youtubeId: string;
  title: string;
  url: string;
  role: BrandSourceRole;
  addedAt: Date;
  lastPolledAt: Date | null;
  /** Every stored video of this channel. */
  videoCount: number;
  /** Of those, how many have a successful analysis. */
  analyzedCount: number;
  /** Median views of the outlier baseline (last 30 with a view count); null under 5 videos. */
  medianViews: number | null;
  latestPublishedAt: Date | null;
};

/** A brand's linked channels with stats, newest link first; optionally one role only. */
export async function listBrandCompetitors(
  brandId: string,
  options: { role?: BrandSourceRole } = {},
): Promise<BrandCompetitor[]> {
  if (options.role) assertRole(options.role);
  const roleFilter = options.role ? sql`and bs.role = ${options.role}` : sql``;

  // One statement: per-channel counts, and the same baseline window the
  // outlier query uses, so the median shown here is the one scores divide by.
  const result = await queryRows<Record<string, unknown>>(
    db,
    sql`
    with linked as (
      select bs.source_id, bs.role, bs.added_at
      from brand_sources bs
      where bs.brand_id = ${brandId} ${roleFilter}
    ),
    ranked as (
      select v.source_id, v.view_count,
        row_number() over (
          partition by v.source_id
          order by v.published_at is null, v.published_at desc, v.id desc
        ) as rn
      from videos v
      join linked l on l.source_id = v.source_id
      where v.view_count is not null
    ),
    sample as (
      select source_id, view_count,
        row_number() over (partition by source_id order by view_count) as value_rank,
        count(*) over (partition by source_id) as n
      from ranked
      where rn <= ${OUTLIER_BASELINE_SIZE}
    ),
    baseline as (
      select source_id, max(n) as n, avg(view_count) as median_views
      from sample
      where value_rank in (floor((n + 1) / 2), floor((n + 2) / 2))
      group by source_id
    ),
    counts as (
      select v.source_id,
        count(*) as video_count,
        sum(case when exists (
          select 1 from analyses a where a.video_id = v.id and a.status = 'ok'
        ) then 1 else 0 end) as analyzed_count,
        max(v.published_at) as latest_published_at
      from videos v
      join linked l on l.source_id = v.source_id
      group by v.source_id
    )
    select s.id as source_id, s.youtube_id, s.title, s.url, s.last_polled_at,
      l.role, l.added_at,
      coalesce(c.video_count, 0) as video_count,
      coalesce(c.analyzed_count, 0) as analyzed_count,
      c.latest_published_at,
      case when b.n >= ${OUTLIER_MIN_SAMPLE} then b.median_views end as median_views
    from linked l
    join sources s on s.id = l.source_id
    left join counts c on c.source_id = l.source_id
    left join baseline b on b.source_id = l.source_id
    order by l.added_at desc, s.id desc
  `,
  );

  return result.map((r) => ({
    sourceId: Number(r.source_id),
    youtubeId: String(r.youtube_id),
    title: String(r.title),
    url: String(r.url),
    role: r.role as BrandSourceRole,
    addedAt: toDate(r.added_at)!,
    lastPolledAt: toDate(r.last_polled_at),
    videoCount: Number(r.video_count),
    analyzedCount: Number(r.analyzed_count),
    medianViews: toNumber(r.median_views),
    latestPublishedAt: toDate(r.latest_published_at),
  }));
}

/** One row of the outlier board. */
export type BrandOutlier = {
  videoId: number;
  youtubeId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  viewCount: number;
  sourceId: number;
  sourceTitle: string;
  role: BrandSourceRole;
  /** The channel's baseline median views — what `score` divides by. */
  medianViews: number;
  /** views / medianViews (§1.30). */
  score: number;
  /** Latest successful analysis, when the video has been analysed. */
  analysisId: number | null;
  analysisSummary: string | null;
};

export type BrandOutliersQuery = {
  /** Only videos published in the last N days (by the database's clock). Default 90. */
  days?: number;
  /** Default 50, max 200. */
  limit?: number;
  /** Only one role's channels; both by default. */
  role?: BrandSourceRole;
};

/**
 * A brand's top outliers: its linked channels' videos from the last N days,
 * ranked by views ÷ own-channel median (§1.30), with the analysis summary if any.
 */
export async function topOutliersForBrand(
  brandId: string,
  query: BrandOutliersQuery = {},
): Promise<BrandOutlier[]> {
  const days = Math.max(1, Math.floor(query.days ?? 90));
  const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 50)));
  if (query.role) assertRole(query.role);
  const roleFilter = query.role ? sql`and bs.role = ${query.role}` : sql``;

  // One statement per brand, not a loop per channel (§5.O7 phase rules). The
  // baseline is each channel's last 30 videos overall — not just the window —
  // so a quiet month does not shrink the sample; `lib/research/outlier.ts` is
  // the reference this must agree with, and the integration test holds it to it.
  const result = await queryRows<Record<string, unknown>>(
    db,
    sql`
    with linked as (
      select bs.source_id, bs.role
      from brand_sources bs
      where bs.brand_id = ${brandId} ${roleFilter}
    ),
    ranked as (
      select v.source_id, v.view_count,
        row_number() over (
          partition by v.source_id
          order by v.published_at is null, v.published_at desc, v.id desc
        ) as rn
      from videos v
      join linked l on l.source_id = v.source_id
      where v.view_count is not null
    ),
    sample as (
      select source_id, view_count,
        row_number() over (partition by source_id order by view_count) as value_rank,
        count(*) over (partition by source_id) as n
      from ranked
      where rn <= ${OUTLIER_BASELINE_SIZE}
    ),
    baseline as (
      select source_id, max(n) as n, avg(view_count) as median_views
      from sample
      where value_rank in (floor((n + 1) / 2), floor((n + 2) / 2))
      group by source_id
    )
    select v.id as video_id, v.youtube_id, v.title, v.channel_title, v.thumbnail_url,
      v.published_at, v.duration_seconds, v.view_count,
      s.id as source_id, s.title as source_title, l.role,
      b.median_views,
      (v.view_count * 1e0) / b.median_views as score,
      a.id as analysis_id, a.summary as analysis_summary
    from videos v
    join linked l on l.source_id = v.source_id
    join sources s on s.id = v.source_id
    join baseline b on b.source_id = v.source_id
      and b.n >= ${OUTLIER_MIN_SAMPLE} and b.median_views > 0
    left join analyses a on a.id = (
      select an.id from analyses an
      where an.video_id = v.id and an.status = 'ok'
      order by an.id desc limit 1
    )
    where v.view_count is not null
      and v.published_at >= date_sub(current_timestamp(3), interval ${days} day)
    order by score desc, v.id desc
    limit ${limit}
  `,
  );

  return result.map((r) => ({
    videoId: Number(r.video_id),
    youtubeId: String(r.youtube_id),
    title: String(r.title),
    channelTitle: (r.channel_title as string | null) ?? null,
    thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
    publishedAt: toDate(r.published_at),
    durationSeconds: toNumber(r.duration_seconds),
    viewCount: Number(r.view_count),
    sourceId: Number(r.source_id),
    sourceTitle: String(r.source_title),
    role: r.role as BrandSourceRole,
    medianViews: Number(r.median_views),
    score: Number(r.score),
    analysisId: toNumber(r.analysis_id),
    analysisSummary: (r.analysis_summary as string | null) ?? null,
  }));
}

// Raw `execute` rows skip drizzle's column mapping, so they arrive as the
// driver hands them: bigint as a string, and `timestamp` (without time zone) as
// text like "2026-01-01 12:00:00". The app writes those columns in UTC, which is
// how drizzle's own mapping reads them back — so a zone-less string is UTC
// here too, never the machine's local time (Anton's PC is not in UTC).
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  const zoned = /(z|[+-]\d\d(:?\d\d)?)$/i.test(text);
  return new Date(zoned ? text : `${text.replace(" ", "T")}Z`);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

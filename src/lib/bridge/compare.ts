import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { queryRows } from "@/db/mutations";
import type { BrandSourceRole } from "@/db/schema";
import { OUTLIER_BASELINE_SIZE, OUTLIER_MIN_SAMPLE } from "@/lib/research/outlier";

/**
 * Own channel vs competitors (build 2b, idea 4). A brand's channel linked with
 * role `own` is set beside the channels it studies, with the same figures for
 * each. Pure SQL over stored rows: no model, no YouTube call, so the numbers
 * are only as fresh as the last `npm run yt:poll`.
 *
 * The median and the outlier score are §1.30's, computed the same way as
 * `bridge/research.ts` (last 30 videos with a view count, min 5 to score) so a
 * channel shows the same median on both pages.
 */

/** Uploads per month are counted over this many days, then scaled to 30. */
export const UPLOAD_WINDOW_DAYS = 90;
/** Best videos per channel. */
export const BEST_PER_CHANNEL = 5;
/** Titles per column in the side-by-side. */
export const TITLES_PER_SIDE = 10;

export type CompareVideo = {
  videoId: number;
  youtubeId: string;
  title: string;
  sourceId: number;
  sourceTitle: string;
  viewCount: number;
  publishedAt: Date | null;
  /** views ÷ the channel's median; null when the channel has no baseline yet. */
  score: number | null;
};

export type CompareChannel = {
  sourceId: number;
  title: string;
  url: string;
  role: BrandSourceRole;
  videoCount: number;
  /** Median views of the last 30 videos with a view count; null under 5. */
  medianViews: number | null;
  /** Videos published in the last 90 days, per 30 days, one decimal. */
  uploadsPerMonth: number;
  /** Top five by outlier score. Empty while the channel has no baseline. */
  best: CompareVideo[];
};

export type BrandComparison = {
  /** Own channels first, then by median views (unknown last), then title. */
  channels: CompareChannel[];
  /** The own channel(s)' latest titles, newest first. */
  ownTitles: CompareVideo[];
  /** The competitors' and inspirations' best titles by outlier score, across channels. */
  competitorTitles: CompareVideo[];
};

/** Everything `/research/compare` shows for a brand, in three statements. */
export async function compareBrandChannels(brandId: string): Promise<BrandComparison> {
  const baselineCte = sql`
    linked as (
      select bs.source_id, bs.role from brand_sources bs where bs.brand_id = ${brandId}
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
    )`;

  const [stats, scored, own] = await Promise.all([
    queryRows<Record<string, unknown>>(
      db,
      sql`
      with ${baselineCte},
      counts as (
        select v.source_id,
          count(*) as video_count,
          sum(case when v.published_at >= date_sub(current_timestamp(3), interval ${UPLOAD_WINDOW_DAYS} day)
            then 1 else 0 end) as recent_uploads
        from videos v
        join linked l on l.source_id = v.source_id
        group by v.source_id
      )
      select s.id as source_id, s.title, s.url, l.role,
        coalesce(c.video_count, 0) as video_count,
        coalesce(c.recent_uploads, 0) as recent_uploads,
        case when b.n >= ${OUTLIER_MIN_SAMPLE} then b.median_views end as median_views
      from linked l
      join sources s on s.id = l.source_id
      left join counts c on c.source_id = l.source_id
      left join baseline b on b.source_id = l.source_id
    `,
    ),
    queryRows<Record<string, unknown>>(
      db,
      sql`
      with ${baselineCte},
      scored as (
        select v.id as video_id, v.youtube_id, v.title, v.view_count, v.published_at,
          v.source_id, s.title as source_title, l.role,
          (v.view_count * 1e0) / b.median_views as score,
          row_number() over (
            partition by v.source_id
            order by (v.view_count * 1e0) / b.median_views desc, v.id desc
          ) as best_rank
        from videos v
        join linked l on l.source_id = v.source_id
        join sources s on s.id = v.source_id
        join baseline b on b.source_id = v.source_id
          and b.n >= ${OUTLIER_MIN_SAMPLE} and b.median_views > 0
        where v.view_count is not null
      )
      select * from scored where best_rank <= ${BEST_PER_CHANNEL}
      order by score desc, video_id desc
    `,
    ),
    queryRows<Record<string, unknown>>(
      db,
      sql`
      with ${baselineCte}
      select v.id as video_id, v.youtube_id, v.title, v.view_count, v.published_at,
        v.source_id, s.title as source_title,
        case when b.n >= ${OUTLIER_MIN_SAMPLE} and b.median_views > 0 and v.view_count is not null
          then (v.view_count * 1e0) / b.median_views end as score
      from videos v
      join linked l on l.source_id = v.source_id and l.role = 'own'
      join sources s on s.id = v.source_id
      left join baseline b on b.source_id = v.source_id
      order by v.published_at is null, v.published_at desc, v.id desc
      limit ${TITLES_PER_SIDE}
    `,
    ),
  ]);

  const toVideo = (r: Record<string, unknown>): CompareVideo => ({
    videoId: Number(r.video_id),
    youtubeId: String(r.youtube_id),
    title: String(r.title),
    sourceId: Number(r.source_id),
    sourceTitle: String(r.source_title),
    viewCount: Number(r.view_count ?? 0),
    publishedAt: toDate(r.published_at),
    score: toNumber(r.score),
  });

  const best = scored.map((r) => ({ role: r.role as BrandSourceRole, video: toVideo(r) }));
  const channels: CompareChannel[] = stats.map((r) => {
    const sourceId = Number(r.source_id);
    return {
      sourceId,
      title: String(r.title),
      url: String(r.url),
      role: r.role as BrandSourceRole,
      videoCount: Number(r.video_count),
      medianViews: toNumber(r.median_views),
      uploadsPerMonth: Math.round((Number(r.recent_uploads) * 30 * 10) / UPLOAD_WINDOW_DAYS) / 10,
      best: best.filter((b) => b.video.sourceId === sourceId).map((b) => b.video),
    };
  });
  channels.sort(
    (a, b) =>
      Number(b.role === "own") - Number(a.role === "own") ||
      (b.medianViews ?? -1) - (a.medianViews ?? -1) ||
      a.title.localeCompare(b.title),
  );

  return {
    channels,
    ownTitles: own.map(toVideo),
    competitorTitles: best
      .filter((b) => b.role !== "own")
      .map((b) => b.video)
      .slice(0, TITLES_PER_SIDE),
  };
}

// Raw `execute` rows skip drizzle's column mapping — same reading rules as
// bridge/research.ts: bigint arrives as a string, and a zone-less timestamp is
// UTC (the app writes those columns in UTC).
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

import { upsertReturning } from "@/db/mutations";
import { and, asc, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { describeMatch, type SearchMatch } from "@/lib/search-excerpt";
import {
  analyses,
  entities,
  screenings,
  topics,
  transcripts,
  videoEntities,
  videoReads,
  videoTopics,
  videoUnitMarks,
  videos,
  type Analysis,
  type CaptionStatus,
  type Video,
} from "@/db/schema";

export const DIGEST_PAGE_SIZE = 24;

/**
 * Read-state filter (PR-19). "unread" is `read_at is null`; "pinned" is the
 * flag. They are one control rather than two checkboxes because the useful
 * question is always "show me one of these", never "show me both at once".
 */
export type ReadFilter = "unread" | "pinned" | "marked";

/** Sort orders offered by the feed. `published` stays the default. */
export type DigestSort = "published" | "added" | "views";

export type DigestQuery = {
  /**
   * Whose read state to show (PR-25). Required rather than optional: read state
   * is per-user now, and a default would quietly show one user another's.
   */
  userId: number;
  q?: string;
  status?: CaptionStatus;
  filter?: ReadFilter;
  /**
   * [PR-34] Restrict to videos tagged with this topic or entity slug.
   *
   * The grouping pages are the feed with one extra condition rather than a
   * parallel listing, so they inherit pagination, per-user read state, the
   * search box and the cards for free — and so a change to any of those can
   * never apply to one view and not the other.
   */
  topicSlug?: string;
  entitySlug?: string;
  /** [PR-34] Restrict to one shape of video: tutorial, case study, news… */
  contentType?: string;
  sort?: DigestSort;
  page?: number;
};

/**
 * A feed row carries the state of its newest analysis (PR-17). This is a
 * correlated subquery rather than a join because `analyses` is append-only —
 * a join emits one row per attempt and would need de-duplicating in code, and
 * would break the SQL-side pagination the feed depends on.
 */
export type DigestVideo = Video & {
  analysisStatus: Analysis["status"] | null;
  /**
   * Why this video is in the results (PR-30). Null when there is no query.
   * Computed in JS from the summary rather than in SQL: the reason has to be
   * legible.
   */
  match: SearchMatch | null;
  /**
   * Words in the stored transcript, or null when there is none (PR-28). The
   * feed needs it to price a bulk selection before submitting it — an estimate
   * that appears only after the money is committed is not an estimate.
   */
  transcriptWords: number | null;
  /** This user's read state, from the LEFT JOIN — null when never opened. */
  readAt: Date | null;
  pinned: boolean;
  /**
   * [PR-35] The gallring's score, or null when the video has never been
   * screened or its screening failed. A correlated subquery for the same reason
   * as analysisStatus, even though `screenings` holds one row per video: a join
   * here would still have to be a LEFT one, and the two idioms in one query
   * would invite a later reader to "simplify" the wrong one into an inner join.
   */
  screenScore: number | null;
  screenReason: string | null;
};

export type DigestPage = {
  videos: DigestVideo[];
  total: number;
  page: number;
  totalPages: number;
};

const STATUS_VALUES: CaptionStatus[] = ["unknown", "available", "none", "failed"];
const FILTER_VALUES: ReadFilter[] = ["unread", "pinned", "marked"];
const SORT_VALUES: DigestSort[] = ["published", "added", "views"];

export function parseCaptionStatus(value: string | undefined): CaptionStatus | undefined {
  return STATUS_VALUES.find((s) => s === value);
}

export function parseReadFilter(value: string | undefined): ReadFilter | undefined {
  return FILTER_VALUES.find((f) => f === value);
}

export function parseDigestSort(value: string | undefined): DigestSort | undefined {
  return SORT_VALUES.find((s) => s === value);
}

/**
 * Free-text match across the title and the stored analysis (PR-21).
 *
 * EXISTS over `analyses` rather than a join: the table is append-only, so a
 * join would multiply feed rows by the number of attempts per video and break
 * both the COUNT and the LIMIT/OFFSET paging.
 *
 * JSON is searched as text — keys and punctuation included — as §9 asks.
 * Lowering both operands keeps matching case-insensitive even though stored
 * identities use a binary collation. Values remain SQL parameters.
 */
function matchesQuery(q: string) {
  const needle = `%${q}%`;
  return or(
    sql`lower(${videos.title}) like lower(${needle})`,
    sql`exists (
      select 1 from ${analyses} a
      where a.video_id = ${videos.id}
        and a.status = 'ok'
        and (
          lower(a.summary) like lower(${needle})
          or lower(cast(a.takeaways as char character set utf8mb4)) like lower(${needle})
          or lower(cast(a.ideas as char character set utf8mb4)) like lower(${needle})
        )
    )`,
  );
}

/**
 * [PR-37] Videos with at least one starred content unit, for this user.
 *
 * EXISTS rather than a join, for the same reason as every other filter here: a
 * video can carry many marks and a join would emit one feed row per mark,
 * breaking the COUNT and the LIMIT/OFFSET paging.
 *
 * This is the coarse view — "which videos have something in them I flagged".
 * /marks is the fine one, listing the passages themselves.
 */
function hasUnitMark(userId: number) {
  return sql`exists (
    select 1 from ${videoUnitMarks} m
    where m.video_id = ${videos.id} and m.user_id = ${userId}
  )`;
}

function taggedWithTopic(slug: string) {
  return sql`exists (
    select 1 from ${videoTopics} vt
    join ${topics} t on t.id = vt.topic_id
    where vt.video_id = ${videos.id} and t.slug = ${slug}
  )`;
}

function taggedWithEntity(slug: string) {
  return sql`exists (
    select 1 from ${videoEntities} ve
    join ${entities} e on e.id = ve.entity_id
    where ve.video_id = ${videos.id} and e.slug = ${slug}
  )`;
}

/**
 * The content type of the video's *newest successful* analysis.
 *
 * Ordered by id desc rather than filtered on all analyses: re-analysing a video
 * can change its shape, and matching against every historical row would keep
 * returning it under a label the current analysis has abandoned.
 */
function hasContentType(contentType: string) {
  return sql`(
    select a.content_type from ${analyses} a
    where a.video_id = ${videos.id} and a.status = 'ok'
    order by a.id desc limit 1
  ) = ${contentType}`;
}

function orderFor(sort: DigestSort | undefined) {
  switch (sort) {
    case "added":
      return [desc(videos.createdAt), desc(videos.id)];
    case "views":
      // Nulls sort last: a video whose view count was never fetched is not the
      // most-watched thing in the corpus.
      return [asc(isNull(videos.viewCount)), desc(videos.viewCount), desc(videos.id)];
    default:
      return [desc(isNull(videos.publishedAt)), desc(videos.publishedAt), desc(videos.id)];
  }
}

/**
 * Paginates in SQL (LIMIT/OFFSET + a COUNT), not in memory — the corpus grows
 * without bound (docs/HANDOFF-SONNET.md §6, PR-09 row).
 */
export async function listDigestVideos(query: DigestQuery): Promise<DigestPage> {
  const page = Math.max(1, query.page ?? 1);
  // The join condition carries the user id, not the WHERE clause: in the WHERE
  // it would turn the LEFT JOIN back into an inner one and hide every video the
  // user has never opened — which is most of them, and all of the unread ones.
  const readsJoin = and(eq(videoReads.videoId, videos.id), eq(videoReads.userId, query.userId));
  const conditions = [
    query.q ? matchesQuery(query.q) : undefined,
    query.status ? eq(videos.captionStatus, query.status) : undefined,
    // "unread" covers both shapes of unread: no row at all, and a row that
    // exists only because the video is pinned.
    query.filter === "unread" ? isNull(videoReads.readAt) : undefined,
    query.filter === "pinned" ? eq(videoReads.pinned, true) : undefined,
    query.filter === "marked" ? hasUnitMark(query.userId) : undefined,
    // [PR-34] EXISTS rather than a join: a video carries several topics, and
    // joining would emit one row per matching tag and break the SQL-side
    // pagination the feed depends on — the same reason analysisStatus is a
    // correlated subquery.
    query.topicSlug ? taggedWithTopic(query.topicSlug) : undefined,
    query.entitySlug ? taggedWithEntity(query.entitySlug) : undefined,
    // The newest analysis decides the shape, matching what the video page shows.
    query.contentType ? hasContentType(query.contentType) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(videos)
    .leftJoin(videoReads, readsJoin)
    .where(where);
  const total = Number(countRows[0]?.total ?? 0);

  const totalPages = Math.max(1, Math.ceil(total / DIGEST_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);

  const rows = await db
    .select({
      ...getTableColumns(videos),
      analysisStatus: sql<Analysis["status"] | null>`(
        select a.status from ${analyses} a
        where a.video_id = ${videos.id}
        order by a.id desc limit 1
      )`,
      // Only needed to explain a match, so it is loaded only when there is one
      // to explain — every feed page otherwise pays for a text column it does
      // not render.
      analysisSummary: query.q
        ? sql<string | null>`(
            select a.summary from ${analyses} a
            where a.video_id = ${videos.id} and a.status = 'ok'
            order by a.id desc limit 1
          )`
        : sql<string | null>`null`,
      transcriptWords: sql<number | null>`(
        select t.word_count from ${transcripts} t where t.video_id = ${videos.id} limit 1
      )`,
      readAt: videoReads.readAt,
      pinned: videoReads.pinned,
      screenScore: sql<number | null>`(
        select s.score from ${screenings} s
        where s.video_id = ${videos.id} and s.status = 'ok' limit 1
      )`,
      screenReason: sql<string | null>`(
        select s.reason from ${screenings} s
        where s.video_id = ${videos.id} and s.status = 'ok' limit 1
      )`,
    })
    .from(videos)
    .leftJoin(videoReads, readsJoin)
    .where(where)
    // The id tiebreaker is not cosmetic: published_at and view_count are both
    // nullable and both repeat, and without a unique last key the database is
    // free to order ties differently per page, which drops or duplicates rows
    // across LIMIT/OFFSET boundaries.
    .orderBy(...orderFor(query.sort))
    .limit(DIGEST_PAGE_SIZE)
    .offset((clampedPage - 1) * DIGEST_PAGE_SIZE);

  return {
    // The LEFT JOIN yields null for a video this user has never touched, in
    // both columns. read_at keeps that null — it *is* "unread". `pinned` does
    // not: it is rendered as a flag, and a null there reaches JSX as a value
    // React would print rather than skip.
    videos: rows.map(({ analysisSummary, ...row }) => ({
      ...row,
      pinned: row.pinned ?? false,
      match: describeMatch(query.q, row.title, analysisSummary),
    })),
    total,
    page: clampedPage,
    totalPages,
  };
}

/**
 * First-open marks a video read, for this user only (PR-25).
 *
 * An upsert rather than an UPDATE, because the row may not exist yet. The
 * `coalesce` in the update branch is what makes it "first read" rather than
 * "last opened" — re-reading an analysis is free and expected, and a timestamp
 * that moved every time would make the unread filter the only question the
 * column could answer. Deliberately not a server action: this runs during the
 * video page's render, and revalidatePath() is illegal there.
 */
export async function markVideoRead(
  videoId: number,
  userId: number,
  at: Date = new Date(),
): Promise<void> {
  await upsertReturning(
    db,
    videoReads,
    { videoId, userId, readAt: at },
    {
      target: [videoReads.videoId, videoReads.userId],
      set: { readAt: sql`coalesce(${videoReads.readAt}, ${at})` },
    },
  );
}

import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { videoUnitMarks, videos, type Video } from "@/db/schema";
import { unitKey, type UnitType } from "@/lib/listen/units";

/**
 * [PR-37] Reads over `video_unit_marks` — "this bit was interesting", one
 * takeaway or idea at a time.
 *
 * The writes live in marks.actions.ts (they need "use server"); everything a
 * page or a test wants to *ask* is here, so neither has to import an action.
 */

export const MARKS_PAGE_SIZE = 50;

/** `video_unit_marks.unit_text` is varchar(1024). */
export const MARK_TEXT_LIMIT = 1024;

/**
 * A unit's text is stored, not rejected, when it is too long.
 *
 * The alternative — refusing the mark — turns a one-click gesture into an
 * error message over a display detail nobody chose. A 1024-character takeaway
 * would be a strange takeaway; if one arrives, the first thousand characters
 * still identify it.
 */
export function truncateUnitText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MARK_TEXT_LIMIT ? trimmed : trimmed.slice(0, MARK_TEXT_LIMIT);
}

/**
 * Which units of this video this user has marked, as `${type}:${index}` keys.
 *
 * A Set of keys rather than the rows: every caller asks "is this one marked",
 * once per rendered unit, and an array would make that a linear scan per star.
 */
export async function markedUnitKeys(videoId: number, userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ unitType: videoUnitMarks.unitType, unitIndex: videoUnitMarks.unitIndex })
    .from(videoUnitMarks)
    .where(and(eq(videoUnitMarks.videoId, videoId), eq(videoUnitMarks.userId, userId)));
  return new Set(rows.map((row) => unitKey(row.unitType, row.unitIndex)));
}

export type MarksQuery = {
  userId: number;
  /** Free text over the marked passage and the video's title (the PR-21 shape). */
  q?: string;
  unitType?: UnitType;
  page?: number;
};

export type MarkedUnit = {
  videoId: number;
  videoTitle: string;
  videoYoutubeId: string;
  channelTitle: Video["channelTitle"];
  unitType: UnitType;
  unitIndex: number;
  unitText: string;
  createdAt: Date;
};

export type MarksPage = {
  marks: MarkedUnit[];
  total: number;
  page: number;
  totalPages: number;
};

/**
 * Free-text match, deliberately the same shape as the feed's (lib/videos.ts,
 * PR-21/30): a LIKE over the text the reader can see. No new infrastructure,
 * and `like()` parameterises its value.
 *
 * Searching `unit_text` rather than joining back to `analyses` is what makes
 * this composable with the snapshot: a mark whose analysis has since been
 * rewritten is still findable by what it said when it was marked.
 */
function matchesQuery(q: string) {
  const needle = `%${q}%`;
  return or(like(videoUnitMarks.unitText, needle), like(videos.title, needle));
}

/**
 * Everything this user marked, across videos — newest first.
 *
 * An inner join, unlike the feed's LEFT JOIN onto `video_reads`: here a video
 * without a mark is not a row with nulls, it is not a row.
 */
export async function listMarks(query: MarksQuery): Promise<MarksPage> {
  const page = Math.max(1, query.page ?? 1);
  const conditions = [
    eq(videoUnitMarks.userId, query.userId),
    query.q ? matchesQuery(query.q) : undefined,
    query.unitType ? eq(videoUnitMarks.unitType, query.unitType) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = and(...conditions);

  const countRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(videoUnitMarks)
    .innerJoin(videos, eq(videos.id, videoUnitMarks.videoId))
    .where(where);
  const total = countRows[0]?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / MARKS_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);

  const rows = await db
    .select({
      videoId: videoUnitMarks.videoId,
      videoTitle: videos.title,
      videoYoutubeId: videos.youtubeId,
      channelTitle: videos.channelTitle,
      unitType: videoUnitMarks.unitType,
      unitIndex: videoUnitMarks.unitIndex,
      unitText: videoUnitMarks.unitText,
      createdAt: videoUnitMarks.createdAt,
    })
    .from(videoUnitMarks)
    .innerJoin(videos, eq(videos.id, videoUnitMarks.videoId))
    .where(where)
    // created_at repeats — several units get marked in the same second while
    // listening — so the address is the tiebreaker. Without a unique last key
    // MySQL may order ties differently per page and drop rows across the
    // LIMIT/OFFSET boundary (the same trap as the feed's id tiebreaker).
    .orderBy(
      desc(videoUnitMarks.createdAt),
      desc(videoUnitMarks.videoId),
      videoUnitMarks.unitType,
      videoUnitMarks.unitIndex,
    )
    .limit(MARKS_PAGE_SIZE)
    .offset((clampedPage - 1) * MARKS_PAGE_SIZE);

  return { marks: rows, total, page: clampedPage, totalPages };
}

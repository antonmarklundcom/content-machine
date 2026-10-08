import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clips,
  videos,
  type Clip,
  type ClipPlatform,
  type ClipPurpose,
  type ClipStatus,
} from "@/db/schema";

/**
 * Reads over the clip inbox (PLAN.md §2). O2 writes these rows; S3 renders
 * them; nothing else may query the table directly.
 */

export const CLIPS_PAGE_SIZE = 50;

export type ClipsQuery = {
  status?: ClipStatus;
  platform?: ClipPlatform;
  /** Build 3 (§1.43): the capture fields. `tag` is one tag, exact, lower-case. */
  brandId?: string;
  purpose?: ClipPurpose;
  tag?: string;
  page?: number;
};

/**
 * A clip plus the video it turned into, when it turned into one.
 *
 * The YouTube id is what the inbox needs — it is how a clip row links through
 * to `/youtube/video/[id]` and to a thumbnail — and joining for it here is
 * what keeps S3 from having to touch `videos` itself.
 */
export type InboxClip = Clip & {
  videoYoutubeId: string | null;
  videoTitle: string | null;
};

export type ClipsPage = {
  clips: InboxClip[];
  total: number;
  page: number;
  totalPages: number;
};

/**
 * The inbox list: newest save first, optionally narrowed to one status or
 * platform.
 *
 * A LEFT JOIN, not an inner one: the whole point of the inbox is that a clip
 * is useful before anything has been fetched for it (§1.7), so a row with no
 * video is a row, not a gap.
 */
export async function listClips(query: ClipsQuery = {}): Promise<ClipsPage> {
  const page = Math.max(1, query.page ?? 1);
  const conditions = [
    query.status ? eq(clips.status, query.status) : undefined,
    query.platform ? eq(clips.platform, query.platform) : undefined,
    query.brandId ? eq(clips.brandId, query.brandId) : undefined,
    query.purpose ? eq(clips.purpose, query.purpose) : undefined,
    query.tag ? sql`json_contains(${clips.tags}, json_quote(${query.tag}), '$') = 1` : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const countRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(clips)
    .where(where);
  const total = Number(countRows[0]?.total ?? 0);

  const totalPages = Math.max(1, Math.ceil(total / CLIPS_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);

  const rows = await db
    .select({
      clip: clips,
      videoYoutubeId: videos.youtubeId,
      videoTitle: videos.title,
    })
    .from(clips)
    .leftJoin(videos, eq(videos.id, clips.videoId))
    .where(where)
    // saved_at repeats when a share-sheet burst lands in the same second, so
    // the id breaks the tie — without a unique last key, LIMIT/OFFSET can drop
    // a row across a page boundary (the same trap as the feed's tiebreaker).
    .orderBy(desc(clips.savedAt), desc(clips.id))
    .limit(CLIPS_PAGE_SIZE)
    .offset((clampedPage - 1) * CLIPS_PAGE_SIZE);

  return {
    clips: rows.map((row) => ({
      ...row.clip,
      videoYoutubeId: row.videoYoutubeId,
      videoTitle: row.videoTitle,
    })),
    total,
    page: clampedPage,
    totalPages,
  };
}

/** One clip by id, or null. */
export async function getClip(id: number): Promise<Clip | null> {
  const rows = await db.select().from(clips).where(eq(clips.id, id)).limit(1);
  return rows[0] ?? null;
}

/** One clip by URL — the dedupe lookup the save route needs. */
export async function getClipByUrl(url: string): Promise<Clip | null> {
  const rows = await db.select().from(clips).where(eq(clips.url, url)).limit(1);
  return rows[0] ?? null;
}

/**
 * How many clips sit in each status, for the inbox's filter chips. Statuses
 * with no rows are absent rather than zero — the caller knows the enum.
 */
export async function clipCountsByStatus(): Promise<Partial<Record<ClipStatus, number>>> {
  const rows = await db
    .select({ status: clips.status, total: sql<number>`count(*)` })
    .from(clips)
    .groupBy(clips.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));
}

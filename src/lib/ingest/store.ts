import { upsertReturning } from "@/db/mutations";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sources, videos, type Source, type Video } from "@/db/schema";
import type { ChannelMetadata, PlaylistMetadata, VideoMetadata } from "@/lib/youtube/data-api";

/**
 * Idempotent writes for videos and sources (PLAN.md §3: "Every ingest script
 * uses idempotent upsert on youtube_id so it is safe to re-run").
 *
 * Every upsert re-selects by the natural key afterwards rather than trusting
 * a returned row from the ON CONFLICT DO UPDATE — the natural key
 * (youtube_id) is the one thing every caller already has, and re-selecting by
 * it keeps this function's contract identical whether the row was just
 * inserted or already existed.
 */

export async function upsertVideoFromMetadata(
  meta: VideoMetadata,
  sourceId: number | null,
): Promise<Video> {
  const values = {
    youtubeId: meta.youtubeId,
    sourceId,
    title: meta.title,
    description: meta.description,
    channelTitle: meta.channelTitle || null,
    publishedAt: meta.publishedAt,
    durationSeconds: meta.durationSeconds,
    viewCount: meta.viewCount,
    likeCount: meta.likeCount,
    commentCount: meta.commentCount,
    thumbnailUrl: meta.thumbnailUrl,
  };

  await upsertReturning(db, videos, values, {
    target: videos.youtubeId,
    set: {
      title: values.title,
      description: values.description,
      channelTitle: values.channelTitle,
      publishedAt: values.publishedAt,
      durationSeconds: values.durationSeconds,
      // The counters are what re-ingest is for: they are the only fields that
      // move on their own, and PR-33's outlier arithmetic is only as current
      // as the last poll. The rest rarely change, and caption_status must NOT
      // be reset here or every re-run would re-probe videos already known to
      // have no captions.
      //
      // COALESCE onto the stored value rather than overwriting outright: a
      // fetch that omits a count (YouTube hides it, or a flaky response) means
      // "unknown this time", not "zero" or "cleared" — falling back to what's
      // already stored keeps a real prior count instead of a transient miss
      // erasing it.
      viewCount: values.viewCount === null ? sql`${videos.viewCount}` : values.viewCount,
      likeCount: values.likeCount === null ? sql`${videos.likeCount}` : values.likeCount,
      commentCount:
        values.commentCount === null ? sql`${videos.commentCount}` : values.commentCount,
      thumbnailUrl: values.thumbnailUrl,
      // Only claim a video for a source if it does not already belong to one.
      ...(sourceId !== null ? { sourceId } : {}),
    },
  });

  const row = await findVideoByYoutubeId(meta.youtubeId);
  if (!row) throw new Error(`Upserted video ${meta.youtubeId} but could not read it back`);
  return row;
}

export async function findVideoByYoutubeId(youtubeId: string): Promise<Video | null> {
  const [row] = await db.select().from(videos).where(eq(videos.youtubeId, youtubeId)).limit(1);
  return row ?? null;
}

export async function upsertChannelSource(channel: ChannelMetadata): Promise<Source> {
  return upsertSource({
    kind: "channel",
    youtubeId: channel.channelId,
    title: channel.title,
    url: channel.handle
      ? `https://www.youtube.com/@${channel.handle}`
      : `https://www.youtube.com/channel/${channel.channelId}`,
  });
}

export async function upsertPlaylistSource(playlist: PlaylistMetadata): Promise<Source> {
  return upsertSource({
    kind: "playlist",
    youtubeId: playlist.playlistId,
    title: playlist.title,
    url: `https://www.youtube.com/playlist?list=${playlist.playlistId}`,
  });
}

async function upsertSource(input: {
  kind: "channel" | "playlist";
  youtubeId: string;
  title: string;
  url: string;
}): Promise<Source> {
  await upsertReturning(db, sources, input, {
    target: sources.youtubeId,
    set: { title: input.title, url: input.url },
  });

  const [row] = await db
    .select()
    .from(sources)
    .where(eq(sources.youtubeId, input.youtubeId))
    .limit(1);
  if (!row) throw new Error(`Upserted source ${input.youtubeId} but could not read it back`);
  return row;
}

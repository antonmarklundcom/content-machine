import { eq } from "drizzle-orm";
import { db } from "@/db";
import { upsertReturning, type Tx } from "@/db/mutations";
import { transcripts, videos } from "@/db/schema";

/** Serialize transcript/status changes without holding a transaction over network work. */
async function lockVideo(tx: Tx, videoId: number): Promise<void> {
  const [video] = await tx
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1)
    .for("update");
  if (!video) throw new Error("This video no longer exists.");
}

const available = (tx: Tx, videoId: number) =>
  tx
    .update(videos)
    .set({ captionStatus: "available", captionCheckedAt: new Date() })
    .where(eq(videos.id, videoId));

/** Manual evidence and its usable status are one commit. */
export async function storeManualTranscript(videoId: number, content: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockVideo(tx, videoId);
    const value = {
      videoId,
      language: null,
      source: "manual" as const,
      wordCount: content.trim().split(/\s+/).filter(Boolean).length,
      content,
    };
    await upsertReturning(tx, transcripts, value, {
      target: transcripts.videoId,
      set: value,
    });
    await available(tx, videoId);
  });
}

/**
 * Repair legacy status mismatches too. A force-refresh may replace fetched captions,
 * but never the owner's manual transcript.
 */
export async function retainStoredTranscript(videoId: number, force = false): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockVideo(tx, videoId);
    const [existing] = await tx
      .select({ source: transcripts.source })
      .from(transcripts)
      .where(eq(transcripts.videoId, videoId))
      .limit(1);
    if (!existing || (force && existing.source !== "manual")) return false;
    await available(tx, videoId);
    return true;
  });
}

/** A manual transcript entered during fetching wins over any later network result. */
export async function storeFetchedCaptions(
  videoId: number,
  result:
    | { status: "available"; language: string; wordCount: number; content: string }
    | { status: "none" | "failed" },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockVideo(tx, videoId);
    const [existing] = await tx
      .select({ source: transcripts.source })
      .from(transcripts)
      .where(eq(transcripts.videoId, videoId))
      .limit(1);
    if (existing?.source === "manual" || (existing && result.status !== "available")) {
      await available(tx, videoId);
      return false;
    }
    if (result.status === "available") {
      const value = {
        videoId,
        language: result.language,
        source: "captions" as const,
        wordCount: result.wordCount,
        content: result.content,
      };
      await upsertReturning(tx, transcripts, value, {
        target: transcripts.videoId,
        set: value,
      });
    }
    await tx
      .update(videos)
      .set({ captionStatus: result.status, captionCheckedAt: new Date() })
      .where(eq(videos.id, videoId));
    return true;
  });
}

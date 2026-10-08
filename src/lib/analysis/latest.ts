import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses, type Analysis } from "@/db/schema";

/**
 * `analyses` is append-only (docs/HANDOFF-SONNET.md §2) — a video can have
 * several rows across models/prompt versions/failed attempts. This is the one
 * place the UI decides which row represents "the" analysis for a video.
 */
export async function latestAnalysisForVideo(videoId: number): Promise<Analysis | null> {
  const rows = await db
    .select()
    .from(analyses)
    .where(eq(analyses.videoId, videoId))
    .orderBy(desc(analyses.id))
    .limit(1);
  return rows[0] ?? null;
}

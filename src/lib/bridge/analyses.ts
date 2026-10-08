import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses, videos, videoUnitMarks, type Analysis, type Video } from "@/db/schema";
import { latestAnalysisForVideo } from "@/lib/analysis/latest";
import { analysisRowUnits, unitKey, type ContentUnit } from "@/lib/listen/units";

/**
 * The read the promote flow is built on: an analysis payload, flattened into
 * its addressable units, with the ones a given user marked already tagged.
 *
 * Promoting is "turn this takeaway into an idea for that brand", so the two
 * things a caller always needs together are the payload and the marks over it.
 * Fetching them separately and zipping them in a page component is exactly the
 * join §4.7 says the UI phase may not write.
 */

/** One unit of an analysis, plus whether this user starred it. */
export type MarkedContentUnit = ContentUnit & { marked: boolean };

export type AnalysisBundle = {
  video: Video;
  /** Null when the video has never been analysed — a real state, not an error. */
  analysis: Analysis | null;
  /** Empty when there is no analysis, or when the payload carried no content. */
  units: MarkedContentUnit[];
};

/**
 * The latest analysis for a video, its units, and this user's marks over them.
 *
 * "Latest" is delegated to `latestAnalysisForVideo` rather than re-derived:
 * `analyses` is append-only, and two places deciding which row is "the"
 * analysis is two places to disagree.
 */
export async function analysisBundleForVideo(
  videoId: number,
  /**
   * Whose marks to tag. Optional: a caller that only wants the material —
   * the promote endpoint resolving what a unit says — has no user in hand and
   * should not have to invent one. Omitted means every unit reads `marked:
   * false`, which is true of "nobody in particular".
   */
  userId?: number,
): Promise<AnalysisBundle | null> {
  const videoRows = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  const video = videoRows[0];
  if (!video) return null;

  const analysis = await latestAnalysisForVideo(videoId);
  const markRows =
    userId === undefined
      ? []
      : await db
          .select({ unitType: videoUnitMarks.unitType, unitIndex: videoUnitMarks.unitIndex })
          .from(videoUnitMarks)
          .where(and(eq(videoUnitMarks.videoId, videoId), eq(videoUnitMarks.userId, userId)));
  const marked = new Set(markRows.map((row) => unitKey(row.unitType, row.unitIndex)));

  return {
    video,
    analysis,
    units: analysisRowUnits(analysis).map((unit) => ({ ...unit, marked: marked.has(unit.key) })),
  };
}

/**
 * Videos with an analysis worth seeding from, newest analysis first — the
 * "seed from a video" picker's list (§6.S3.2). Only `ok` analyses: a failed
 * row has no payload to ground anything in.
 */
export async function listAnalyzedVideos(limit = 100): Promise<
  {
    analysisId: number;
    videoId: number;
    title: string;
    channelTitle: string | null;
    analyzedAt: Date;
  }[]
> {
  const rows = await db
    .select({
      analysisId: analyses.id,
      videoId: videos.id,
      title: videos.title,
      channelTitle: videos.channelTitle,
      analyzedAt: analyses.createdAt,
    })
    .from(analyses)
    .innerJoin(videos, eq(videos.id, analyses.videoId))
    .where(eq(analyses.status, "ok"))
    .orderBy(desc(analyses.id))
    .limit(limit);

  // One entry per video: analyses are append-only, so a re-analysed video would
  // otherwise appear once per run — and the newest is the one to seed from.
  const seen = new Set<number>();
  return rows.filter((row) => (seen.has(row.videoId) ? false : (seen.add(row.videoId), true)));
}

/** One analysis row by id — what `/api/generate`'s `analysisId` grounding reads. */
export async function getAnalysis(analysisId: number): Promise<Analysis | null> {
  const rows = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
  return rows[0] ?? null;
}

/**
 * An analysis with the video it describes, for anything that has an analysis id
 * and needs to say what it is an analysis *of* — a promoted idea's provenance
 * line, or the "seed from a video" picker.
 */
export async function getAnalysisWithVideo(
  analysisId: number,
): Promise<{ analysis: Analysis; video: Video | null } | null> {
  const rows = await db
    .select({ analysis: analyses, video: videos })
    .from(analyses)
    .leftJoin(videos, eq(videos.id, analyses.videoId))
    .where(eq(analyses.id, analysisId))
    .limit(1);
  const row = rows[0];
  return row ? { analysis: row.analysis, video: row.video } : null;
}

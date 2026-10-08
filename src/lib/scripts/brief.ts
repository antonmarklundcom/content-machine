import "server-only";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { lessons, videos } from "@/db/schema";
import type { PromptFact, PromptLesson, StructureReference } from "@/lib/ai";
import { listFacts } from "@/lib/bridge/facts";
import { latestAnalysisForVideo } from "@/lib/analysis/latest";

/**
 * What the titles and script prompts are given besides the topic: saved
 * lessons (§1.31), competitor analyses as structure references, and the
 * brand's fact sheet (build 2b, idea 3).
 */

/** More than this and the prompt is a lesson dump, not guidance. */
export const MAX_PROMPT_LESSONS = 30;
/** Each reference is a few hundred tokens; the reservation assumes a handful. */
export const MAX_REFERENCE_VIDEOS = 5;

/**
 * Lessons for a prompt. Explicit ids win (in any brand — Anton picked them);
 * otherwise the brand's own and the portfolio-wide ones of `kinds`, newest
 * first. `[]` for no ids and no kinds.
 */
export async function lessonsForPrompt(
  brandId: string,
  options: { ids?: number[]; kinds?: ("lesson" | "hook" | "title_pattern" | "fact")[] },
): Promise<PromptLesson[]> {
  const select = { kind: lessons.kind, text: lessons.text, sourceUrl: lessons.sourceUrl };
  if (options.ids?.length) {
    return db
      .select(select)
      .from(lessons)
      .where(inArray(lessons.id, options.ids.slice(0, MAX_PROMPT_LESSONS)))
      .orderBy(desc(lessons.createdAt));
  }
  if (!options.kinds?.length) return [];
  return db
    .select(select)
    .from(lessons)
    .where(
      and(
        or(eq(lessons.brandId, brandId), isNull(lessons.brandId)),
        inArray(lessons.kind, options.kinds),
      ),
    )
    .orderBy(desc(lessons.createdAt), desc(lessons.id))
    .limit(MAX_PROMPT_LESSONS);
}

/** A fact sheet longer than this is a research dump; the script prompt gets the first ones by topic. */
export const MAX_PROMPT_FACTS = 40;

/** The brand's checked facts for the script prompt, grouped by topic. */
export async function factsForPrompt(brandId: string): Promise<PromptFact[]> {
  const sheet = await listFacts(brandId);
  return sheet
    .slice(0, MAX_PROMPT_FACTS)
    .map((f) => ({ topic: f.topic, claim: f.claim, sourceUrl: f.sourceUrl }));
}

export class UnknownReferenceVideoError extends Error {
  constructor(readonly videoIds: number[]) {
    super(`No analysed video with id ${videoIds.join(", ")}.`);
    this.name = "UnknownReferenceVideoError";
  }
}

/**
 * Structure references for competitor videos (by `videos.id`). Only hook,
 * timeline and gaps travel — see `StructureReference`. A video that does not
 * exist or has no ok analysis is an error: the caller asked for it by name.
 */
export async function structureReferences(videoIds: number[]): Promise<StructureReference[]> {
  const ids = [...new Set(videoIds)].slice(0, MAX_REFERENCE_VIDEOS);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: videos.id, title: videos.title, channelTitle: videos.channelTitle })
    .from(videos)
    .where(inArray(videos.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const refs: StructureReference[] = [];
  const missing: number[] = [];
  for (const id of ids) {
    const video = byId.get(id);
    const analysis = video ? await latestAnalysisForVideo(id) : null;
    if (!video || !analysis || analysis.status !== "ok") {
      missing.push(id);
      continue;
    }
    refs.push({
      videoTitle: video.title,
      channelTitle: video.channelTitle,
      hook: analysis.hookBreakdown,
      timeline: analysis.timeline,
      gaps: analysis.gaps,
    });
  }
  if (missing.length) throw new UnknownReferenceVideoError(missing);
  return refs;
}

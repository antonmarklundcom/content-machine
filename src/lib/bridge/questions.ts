import { insertReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  AUDIENCE_QUESTION_STATUSES,
  audienceQuestions,
  type AudienceQuestion,
  type AudienceQuestionStatus,
} from "@/db/schema";
import {
  mergeExamples,
  mergeIds,
  normalizeQuestion,
  type QuestionCluster,
} from "@/lib/studio/question-filter";

/**
 * Audience questions mined from competitor comments (build 2b, idea 2).
 * Writes as well as reads: upserting clusters and setting a status are this
 * feature's writes, and lane 2 reaches data only through `src/lib/bridge/`.
 */

export function isAudienceQuestionStatus(value: unknown): value is AudienceQuestionStatus {
  return (
    typeof value === "string" && (AUDIENCE_QUESTION_STATUSES as readonly string[]).includes(value)
  );
}

/** A brand's questions, most asked first; one status or all. */
export async function listAudienceQuestions(
  brandId: string,
  opts: { status?: AudienceQuestionStatus; limit?: number } = {},
): Promise<AudienceQuestion[]> {
  const where = opts.status
    ? and(eq(audienceQuestions.brandId, brandId), eq(audienceQuestions.status, opts.status))
    : eq(audienceQuestions.brandId, brandId);
  return db
    .select()
    .from(audienceQuestions)
    .where(where)
    .orderBy(desc(audienceQuestions.askCount), desc(audienceQuestions.id))
    .limit(Math.min(500, Math.max(1, opts.limit ?? 200)));
}

export async function getAudienceQuestion(id: number): Promise<AudienceQuestion | null> {
  const [row] = await db
    .select()
    .from(audienceQuestions)
    .where(eq(audienceQuestions.id, id))
    .limit(1);
  return row ?? null;
}

export async function setAudienceQuestionStatus(
  id: number,
  status: AudienceQuestionStatus,
): Promise<AudienceQuestion | null> {
  if (!isAudienceQuestionStatus(status)) throw new Error(`Unknown status "${String(status)}".`);
  const [row] = await updateReturning(
    db,
    audienceQuestions,
    { status },
    eq(audienceQuestions.id, id),
  );
  return row ?? null;
}

/**
 * Upsert clusters by normalised question text (accents, case and punctuation
 * ignored): a question already on file gets its count bumped and its examples
 * and video ids merged; a new one is inserted as `new`. Its status is kept —
 * a dismissed question stays dismissed however often it is asked again.
 *
 * Returns how many rows were inserted and how many updated. Each cluster is
 * persisted separately; a run that dies halfway leaves the finished rows
 * correct, and the next run merges the rest.
 */
export async function upsertAudienceQuestions(
  brandId: string,
  clusters: QuestionCluster[],
): Promise<{ inserted: number; updated: number }> {
  const existing = await db
    .select()
    .from(audienceQuestions)
    .where(eq(audienceQuestions.brandId, brandId));
  const byKey = new Map(existing.map((row) => [normalizeQuestion(row.question), row]));
  let inserted = 0;
  let updated = 0;

  for (const c of clusters) {
    const key = normalizeQuestion(c.question);
    if (!key) continue;
    const row = byKey.get(key);
    if (row) {
      const [next] = await updateReturning(
        db,
        audienceQuestions,
        {
          askCount: row.askCount + c.askCount,
          examples: mergeExamples(row.examples ?? [], c.examples),
          videoIds: mergeIds(row.videoIds ?? [], c.videoIds),
        },
        eq(audienceQuestions.id, row.id),
      );
      if (next) byKey.set(key, next);
      updated += 1;
    } else {
      const [next] = await insertReturning(db, audienceQuestions, {
        brandId,
        question: c.question,
        askCount: c.askCount,
        examples: mergeExamples([], c.examples),
        videoIds: mergeIds([], c.videoIds),
      });
      if (next) byKey.set(key, next);
      inserted += 1;
    }
  }
  return { inserted, updated };
}

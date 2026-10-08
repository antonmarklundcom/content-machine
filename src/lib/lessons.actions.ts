"use server";

/**
 * Lessons and the no-captions fallback, from the UI (PLAN.md §6.S11).
 *
 * Every action returns `{ ok, … } | { ok: false, error }` rather than
 * throwing: production strips a thrown action's message, and the fallback's
 * refusals ("no duration", "over 90 minutes", "has a transcript", the cap) are
 * exactly the text the owner needs to see.
 */

import { revalidatePath } from "next/cache";
import { LESSON_KINDS, type LessonKind } from "@/db/schema";
import { getBrand, listBrands } from "@/lib/bridge/brands";
import { createLesson, deleteLesson, InvalidLessonError } from "@/lib/bridge/lessons";
import { analyzeWithoutCaptions, fallbackEstimate } from "@/lib/analysis/fallback";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { formatUsd, SpendCapExceededError } from "@/lib/spend";

export type LessonActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export type SaveLessonInput = {
  text: string;
  kind: LessonKind;
  /** Empty or null saves a portfolio-wide lesson. */
  brandId?: string | null;
  videoId?: number | null;
  timestampSec?: number | null;
};

/** Save one lesson. Any signed-in user: a lesson is a note, not spend (§1.20). */
export async function saveLessonAction(
  input: SaveLessonInput,
): Promise<LessonActionResult<{ id: number }>> {
  await requireUser();
  // A server action is a public endpoint: every field is checked, not trusted.
  if (typeof input?.text !== "string") return { ok: false, error: "A lesson needs some text." };
  if (!(LESSON_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: `Unknown kind "${String(input.kind)}".` };
  }
  const brandId =
    typeof input.brandId === "string" && input.brandId.trim() ? input.brandId.trim() : null;
  if (brandId && !(await getBrand(brandId))) return { ok: false, error: `No brand "${brandId}".` };
  const videoId = input.videoId ?? null;
  if (videoId !== null && !isPositiveId(videoId))
    return { ok: false, error: "That is not a video id." };
  const timestampSec = input.timestampSec ?? null;
  if (
    timestampSec !== null &&
    (typeof timestampSec !== "number" || !Number.isFinite(timestampSec))
  ) {
    return { ok: false, error: "The timestamp must be a number of seconds." };
  }

  try {
    const row = await createLesson({
      text: input.text,
      kind: input.kind,
      brandId,
      videoId,
      timestampSec,
    });
    revalidatePath("/lessons");
    return { ok: true, id: row.id };
  } catch (err) {
    if (err instanceof InvalidLessonError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Delete one lesson. Any signed-in user — lessons are hand-written, not paid-for output. */
export async function deleteLessonAction(id: number): Promise<LessonActionResult> {
  await requireUser();
  if (!isPositiveId(id)) return { ok: false, error: "That is not a lesson id." };
  if (!(await deleteLesson(id))) return { ok: false, error: "That lesson no longer exists." };
  revalidatePath("/lessons");
  return { ok: true };
}

/** The brand picker's options, for SaveLessonButton (which S9 mounts on a page that does not load brands). */
export async function lessonBrandOptionsAction(): Promise<{ id: string; name: string }[]> {
  await requireUser();
  return (await listBrands()).map((b) => ({ id: b.id, name: b.name }));
}

/** What a fallback analysis would cost, for the confirm step. Owner only — it prices spend. */
export async function fallbackEstimateAction(
  videoId: number,
): Promise<LessonActionResult<{ estimate: string }>> {
  try {
    await requireOwner("analyse a video without captions");
    if (!isPositiveId(videoId)) return { ok: false, error: "That is not a video id." };
    const estimate = await fallbackEstimate(videoId);
    return estimate.ok
      ? { ok: true, estimate: formatUsd(estimate.estimatedUsd) }
      : { ok: false, error: estimate.reason };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Run the no-captions fallback (§1.35). Owner only, one video, on a click —
 * `analyzeWithoutCaptions` reserves through `withSpendCap` itself.
 */
export async function analyzeWithoutCaptionsAction(
  videoId: number,
): Promise<LessonActionResult<{ message: string }>> {
  try {
    await requireOwner("analyse a video without captions");
    if (!isPositiveId(videoId)) return { ok: false, error: "That is not a video id." };
    const result = await analyzeWithoutCaptions(videoId);
    revalidatePath("/youtube");
    revalidatePath(`/youtube/video/${videoId}`);
    if (result.status === "ok")
      return { ok: true, message: `Analysed for ${formatUsd(result.costUsd)}.` };
    if (result.status === "skipped")
      return { ok: true, message: "Already analysed — nothing was spent." };
    return { ok: false, error: result.error };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof SpendCapExceededError) {
      return { ok: false, error: err.message };
    }
    // FallbackRefusedError / FallbackNotFoundError: their messages are the explanation.
    return { ok: false, error: err instanceof Error ? err.message : "Analysis failed." };
  }
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clips } from "@/db/schema";
import { getBrand, getClip } from "@/lib/bridge";
import { requireOwner, requireUser } from "@/lib/auth/session";
import {
  isClipPurpose,
  normalizeTags,
  processYouTubeClip,
  updateClipCapture,
} from "@/lib/clips/save";

/**
 * Inbox management actions (PLAN.md §6.S3.1). Not a third write path onto
 * `clips` — retry re-runs the exact function `POST /api/clips` calls
 * (`processYouTubeClip`, O2), and dismiss is the same kind of row delete
 * `removeSource` already does for `sources`. Both owner-only: retry can spend
 * (the same analysis call `/api/clips` makes), and dismiss throws a row away,
 * matching the spend/destroy boundary in `src/lib/auth/roles.ts`.
 */

export type ClipActionResult = { ok: true } | { ok: false; error: string };

export async function retryClipAction(clipId: number): Promise<ClipActionResult> {
  await requireOwner("retry a clip");

  const clip = await getClip(clipId);
  if (!clip) return { ok: false, error: "No such clip." };
  if (clip.platform !== "youtube") {
    return { ok: false, error: "Only YouTube clips can be retried here." };
  }

  const result = await processYouTubeClip(clip);
  revalidatePath("/inbox");
  return result.status === "failed"
    ? { ok: false, error: result.error ?? "Retry failed." }
    : { ok: true };
}

export async function dismissClipAction(clipId: number): Promise<void> {
  await requireOwner("dismiss a clip");
  // Removes the inbox row only — a linked video or idea (§1.3/§2) is untouched,
  // the same "the row is a pointer, not the thing" reasoning as removeSource.
  await db.delete(clips).where(eq(clips.id, clipId));
  revalidatePath("/inbox");
}

/**
 * [S16] Inline edit of a clip's brand, purpose and tags from the inbox. Free and
 * reversible, so any signed-in user may do it, like editing a post. An unknown
 * brand id (deleted since the page loaded) is stored as no brand, not guessed.
 */
export async function updateClipCaptureAction(clipId: number, formData: FormData): Promise<void> {
  await requireUser();

  const brandRaw = String(formData.get("brandId") ?? "").trim();
  const purposeRaw = String(formData.get("purpose") ?? "other");
  const brandId = brandRaw && (await getBrand(brandRaw)) ? brandRaw : null;
  const purpose = isClipPurpose(purposeRaw) ? purposeRaw : "other";
  const tags = normalizeTags(String(formData.get("tags") ?? ""));

  await updateClipCapture(clipId, { brandId, purpose, tags });
  revalidatePath("/inbox");
}

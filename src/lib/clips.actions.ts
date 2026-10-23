"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clips } from "@/db/schema";
import { getBrand, getClip } from "@/lib/bridge";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { reapStuckClips } from "@/lib/clips/recovery";
import { clipWorkLease, CLIP_WORK_LEASE_TTL_MS, ClipWorkBusyError } from "@/lib/clips/work";
import { LeaseLostError, withLeaseCommit, withRenewableLease } from "@/lib/lease";
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
  await reapStuckClips();

  const clip = await getClip(clipId);
  if (!clip) return { ok: false, error: "No such clip." };
  if (clip.platform !== "youtube") {
    return { ok: false, error: "Only YouTube clips can be retried here." };
  }

  try {
    const result = await processYouTubeClip(clip);
    revalidatePath("/inbox");
    return result.error ? { ok: false, error: result.error } : { ok: true };
  } catch (err) {
    if (err instanceof ClipWorkBusyError || err instanceof LeaseLostError)
      return { ok: false, error: err.message };
    throw err;
  }
}

export async function dismissClipAction(clipId: number): Promise<void> {
  await requireOwner("dismiss a clip");
  // Removes the inbox row only — a linked video or idea (§1.3/§2) is untouched,
  // the same "the row is a pointer, not the thing" reasoning as removeSource.
  const held = await withRenewableLease(clipWorkLease(clipId), CLIP_WORK_LEASE_TTL_MS, (lease) =>
    withLeaseCommit(lease, (tx) => tx.delete(clips).where(eq(clips.id, clipId))),
  );
  if (!held.acquired) redirect("/inbox?notice=clip-busy");
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

  try {
    await updateClipCapture(clipId, { brandId, purpose, tags });
  } catch (err) {
    if (err instanceof ClipWorkBusyError) redirect("/inbox?notice=clip-busy");
    throw err;
  }
  revalidatePath("/inbox");
}

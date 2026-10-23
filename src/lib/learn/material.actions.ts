"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { clips } from "@/db/schema";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { withLeaseCommit, withRenewableLease } from "@/lib/lease";
import type { LearnActionResult } from "@/lib/learn.actions";
import { parseLearnMaterial } from "./material";
import { clipWorkLease, CLIP_WORK_LEASE_TTL_MS } from "@/lib/clips/work";

/** Save evidence only. This action never fetches, summarises or spends. */
export async function saveLearnMaterialAction(
  clipId: number,
  caption: string,
  transcript: string,
): Promise<LearnActionResult> {
  try {
    await requireOwner("save learning source material");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "Only the owner can do this." };
    throw err;
  }
  const material = parseLearnMaterial(clipId, caption, transcript);
  if (!material)
    return {
      ok: false,
      error: "Invalid item or text. Each field must be at most 100,000 characters.",
    };
  const held = await withRenewableLease(clipWorkLease(clipId), CLIP_WORK_LEASE_TTL_MS, (lease) =>
    withLeaseCommit(lease, async (tx): Promise<LearnActionResult> => {
      const condition = and(eq(clips.id, clipId), eq(clips.purpose, "learn"));
      const [clip] = await tx.select().from(clips).where(condition).limit(1);
      if (!clip) return { ok: false, error: "No such learning item." };
      if (clip.postText === material.caption && clip.transcript === material.transcript)
        return { ok: true, message: "Source material is unchanged." };
      await tx
        .update(clips)
        .set({
          postText: material.caption,
          transcript: material.transcript,
          summary: null,
          learnCategory: null,
          howToStart: null,
          learnDetails: null,
          error: null,
        })
        .where(condition);
      return { ok: true, message: "Source material saved. Press Summarise when ready." };
    }),
  );
  if (held.acquired && held.value.ok) {
    revalidatePath("/learn");
    revalidatePath("/inbox");
  }
  return held.acquired
    ? held.value
    : { ok: false, error: "This item is being processed. Try saving again when it finishes." };
}
